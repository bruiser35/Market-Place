"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ImagePlus, Images } from "lucide-react";
import { categorySuggestions } from "@/lib/category-approval";
import { money } from "@/lib/catalogue";
import ArtworkActions from './artwork-actions';
import { api } from "@/lib/client";

type Listing = {
  id: string;
  title: string;
  category: string;
  type: string;
  price_cents: number;
  status: "draft" | "published" | "archived";
  quality: string;
  updated_at: number;
  preview_front: string | null;
  preview_back: string | null;
  metadata_json: string | null;
};
type Approval = { id: string; title: string; error?: string; lowDpiWarning?: boolean };
type Page = { items: Listing[]; total: number; pageSize: number; page: number };
function reviewable(item: Listing, metadata: any, categories: string[]) {
  return item.status === "draft" && metadata && !metadata.qualityFlags?.length
    && Boolean((metadata.approvedCategories ?? categorySuggestions(metadata, categories)).length);
}
const MAX_SELECTED = 20;

export default function Catalogue({ categories, category, setCategory, refreshKey, onReview, onPrepare, busy }: {
  categories: string[];
  category: string;
  setCategory: (name: string) => void;
  refreshKey: number;
  onReview: (id: string) => void;
  onPrepare: () => void;
  busy: boolean;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<Page>();
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const approvalActive = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(pageNumber), category, status: filter, q: query });
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void api("admin/products?" + params).then((result: Page) => {
        if (cancelled) return;
        if (result.page > 1 && !result.items.length) {
          setPageNumber(Math.max(1, Math.ceil(result.total / result.pageSize)));
        } else {
          setPage(result);
          setSelected(previous => previous.filter(id => result.items.some(item => item.id === id && item.status === "draft")));
          setConfirmed(false);
          setLoading(false);
        }
      }).catch(error => {
        if (!cancelled) { setError(error.message); setLoading(false); }
      });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pageNumber, category, filter, query, reload, refreshKey]);

  function clearSelection() {
    setSelected([]);
    setConfirmed(false);
  }
  function toggle(id: string) {
    setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
    setConfirmed(false);
  }

  async function approveSelected() {
    if (!confirmed || !page || !selected.length || approvalActive.current) return;
    approvalActive.current = true;
    setApproving(true);
    setApprovals([]);
    const results: Approval[] = [];
    try {
      for (const item of page.items.filter(item => selected.includes(item.id))) {
        const result: Approval = { id: item.id, title: item.title };
        try {
          const path = "admin/products/" + item.id;
          const latest = await api(path);
          const { product, metadata } = latest;
          if (product.status !== "published") {
            if (product.status !== "draft" || product.updated_at !== item.updated_at) throw new Error("Draft changed. Open it to review the latest version.");
            if (!metadata || metadata.qualityFlags?.length) throw new Error("AI image-check flags: "+(metadata?.qualityFlags?.join("; ")||"Analysis is not ready")+". Open review to inspect the artwork.");
            const chosen = metadata.categoriesApprovedAt ? metadata.approvedCategories : categorySuggestions(metadata, categories);
            if (!chosen?.length) throw new Error("Open the draft to choose a category.");
            let updatedAt = product.updated_at;
            if (!metadata.categoriesApprovedAt) {
              const saved = await api(path, { method: "PATCH", body: JSON.stringify({ action: "categories", categories: chosen, updatedAt }) });
              updatedAt = saved.updatedAt;
            }
            const published = await api(path, { method: "PATCH", body: JSON.stringify({ action: "publish", reviewed: true, ownOriginal: true, updatedAt }) });
            result.lowDpiWarning = published.lowDpiWarning;
          }
        } catch (error) {
          result.error = error instanceof Error ? error.message : "Approval failed.";
        }
        results.push(result);
        setApprovals([...results]);
      }
    } finally {
      approvalActive.current = false;
      setApproving(false);
      clearSelection();
      setReload(value => value + 1);
    }
  }

  const disabled = busy || approving;
  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  return <section className="admin-card">
    <div className="section-heading"><div><h2>Your artwork catalogue</h2><p>Review your drafts individually or approve up to {MAX_SELECTED} together.</p></div>
      <button type="button" className="button primary" disabled={disabled} onClick={onPrepare}>Prepare artwork <ImagePlus size={16} /></button></div>
    <div className="category-tabs" role="group" aria-label="Browse approved artwork categories" style={{ flexWrap: "wrap" }}>
      {categories.map(name => <button key={name} aria-pressed={category === name} className={category === name ? "active" : ""} disabled={disabled}
        onClick={() => { setCategory(name); setPageNumber(1); clearSelection(); }}>{name}</button>)}
    </div>
    <div className="form-row" style={{ margin: "14px 0" }}>
      <label>Search artwork<input className="field" value={query} disabled={disabled} maxLength={150}
        onChange={event => { setQuery(event.target.value); setPageNumber(1); clearSelection(); }} /></label>
      <label>Status<select className="field" value={filter} disabled={disabled}
        onChange={event => { setFilter(event.target.value); setPageNumber(1); clearSelection(); }}>
        <option value="all">All listings</option><option value="draft">Drafts</option><option value="published">Published</option><option value="archived">Archived</option>
      </select></label>
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loading && <p role="status">Loading catalogue…</p>}
    {!loading && !!page?.items.length && <div className="table-wrap"><table className="catalogue-table">
      <thead><tr><th scope="col"><button type="button" className="text-link" disabled={disabled}
        onClick={() => {
          const ids = page.items.filter(item => item.metadata_json && reviewable(item, JSON.parse(item.metadata_json), categories)).slice(0, MAX_SELECTED).map(item => item.id);
          setSelected(ids);setConfirmed(false);
        }}>Select up to {MAX_SELECTED}</button></th><th scope="col">Artwork</th><th scope="col">Price</th><th scope="col">Status</th><th scope="col">Review</th></tr></thead>
      <tbody>{page.items.map(item => {
        const metadata = item.metadata_json ? JSON.parse(item.metadata_json) : null;
        const categoriesForDraft: string[] = metadata?.approvedCategories ?? categorySuggestions(metadata, categories);
        const canApprove = reviewable(item, metadata, categories);
        const checked = selected.includes(item.id);
        return <tr key={item.id}>
          <td>{canApprove && <input aria-label={`Select ${item.title}`} type="checkbox" checked={checked} disabled={disabled || (!checked && selected.length >= MAX_SELECTED)} onChange={() => toggle(item.id)} />}</td>
          <td><div style={{display:"flex",gap:6}}>{(["front","back"] as const).map(side => {
            const preview = item[`preview_${side}`];
            return preview && <button key={side} type="button" className="category-thumbnail" aria-label={`View ${item.title} ${side}`} disabled={disabled} onClick={() => onReview(item.id)}><img loading="lazy" src={`/api/assets/${preview}`} alt="" /></button>;
          })}</div><strong>{item.title}</strong>
            <small className="muted" style={{ display: "block" }}>{item.type === "pair" ? "Front + rear" : item.type}</small>
            <small className="muted" style={{ display: "block" }}>{categoriesForDraft.length ? categoriesForDraft.join(" · ") : item.category}</small></td>
          <td>{money(item.price_cents)}</td>
          <td><span className={`quality-tag ${item.status === "published" ? "pass" : ""}`}>{item.status.toUpperCase()}</span>
            {item.status === "draft" && metadata?.qualityFlags?.length > 0 && <div className="low-dpi-note"><strong>AI review needed</strong><ul>{metadata.qualityFlags.map((flag:string,index:number)=><li key={index}>{flag}</li>)}</ul></div>}
            {item.quality === "approved_low_dpi" && <small className="low-dpi-note">Low DPI · owner approved</small>}</td>
          <td><button type="button" className="text-link" disabled={disabled} onClick={() => onReview(item.id)}>Open review <ArrowUpRight size={14} /></button><ArtworkActions allowHide id={item.id} title={item.title} categories={categories} disabled={disabled} onChanged={()=>setReload(v=>v+1)}/></td>
        </tr>;
      })}</tbody>
    </table></div>}
    {!loading && page?.total === 0 && <div className="table-empty"><Images size={28} /><p>No listings match these filters.</p></div>}
    {selected.length > 0 && <div className="form-actions" style={{ marginTop: 12 }}>
      <label className="checkbox-line"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} />
        I reviewed the selected artwork, listing details and categories, and confirm we own the artwork.</label>
      <button type="button" className="button primary" disabled={disabled || !confirmed || loading} onClick={() => void approveSelected()}>
        {approving ? `Approving ${approvals.length} of ${selected.length}…` : `Approve selected (${selected.length})`}
      </button>
    </div>}
    {approvals.length > 0 && <div role="status"><p>{approvals.filter(result => !result.error).length} approved. {approvals.filter(result => result.error).length} need review.</p>
      <ul>{approvals.map(result => <li key={result.id}><strong>{result.title}</strong> · {result.error || (result.lowDpiWarning ? "Approved with low DPI warning" : "Approved")}
        {result.error && <button type="button" className="text-link" disabled={disabled} onClick={() => onReview(result.id)}>Open review</button>}</li>)}</ul>
    </div>}
    {totalPages > 1 && <nav className="form-actions" style={{ marginTop: 16 }} aria-label="Admin catalogue pages">
      <button type="button" className="button secondary" disabled={disabled || loading || pageNumber <= 1}
        onClick={() => { setPageNumber(value => value - 1); clearSelection(); }}>Previous</button>
      <span>Page {pageNumber} of {totalPages} · {page?.total} listings</span>
      <button type="button" className="button secondary" disabled={disabled || loading || pageNumber >= totalPages}
        onClick={() => { setPageNumber(value => value + 1); clearSelection(); }}>Next</button>
    </nav>}
  </section>;
}
