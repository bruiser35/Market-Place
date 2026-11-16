import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:"PrintWear — Original art. Ready to wear.",description:"Discover original digital DTF artwork, matching front and back designs, and themed collections. Made for your next favourite tee.",robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en-AU"><body>{children}</body></html>}
