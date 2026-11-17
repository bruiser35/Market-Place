import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ETSY_TAXONOMY,validEtsyPath} from '../lib/etsy-taxonomy-data';
import {DIGITAL_ART_PATHS} from '../lib/etsy-taxonomy';
test('official public Etsy snapshot retains every extracted path and complete hierarchy',()=>{
 assert.equal(ETSY_TAXONOMY.count,3065);assert.equal(ETSY_TAXONOMY.paths.length,3065);assert.equal(new Set(ETSY_TAXONOMY.paths).size,3065);assert.equal(ETSY_TAXONOMY.source,'https://www.etsy.com/help/categories/seller');
 const paths=new Set(ETSY_TAXONOMY.paths);for(const path of paths){const parts=path.split(' > ');if(parts.length>1)assert.ok(paths.has(parts.slice(0,-1).join(' > ')),path)}
 assert.equal(ETSY_TAXONOMY.paths.filter(p=>!p.includes(' > ')).length,15);
 assert.ok(validEtsyPath('Craft Supplies & Tools > Canvas & Surfaces > Stencils, Templates & Transfers > Clip Art & Image Files'));assert.equal(validEtsyPath('Imaginary > Category'),false);
});
test('digital PNG recommendations do not confuse the depicted item with a physical product for sale',()=>{
 assert.equal(DIGITAL_ART_PATHS.length,3);assert.ok(DIGITAL_ART_PATHS.every(validEtsyPath));assert.ok(!DIGITAL_ART_PATHS.some(p=>/T-Shirts|Digital Music|Embroidery/.test(p)));assert.ok(DIGITAL_ART_PATHS.includes('Art & Collectibles > Prints > Digital Prints'));
});
