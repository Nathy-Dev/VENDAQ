import HomeSessionGate from "@/components/HomeSessionGate";
import LandingPage from "@/components/LandingPage";
import { publicPageMetadata, publicPages, siteName, siteOrigin } from "@/lib/seo";

export const metadata = publicPageMetadata("/");

const homeUrl = `${siteOrigin}/`;
const organizationId = `${homeUrl}#organization`;
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": organizationId, name: siteName, url: homeUrl, logo: `${siteOrigin}/icon.png` },
    { "@type": "WebSite", "@id": `${homeUrl}#website`, name: siteName, url: homeUrl, inLanguage: "en", publisher: { "@id": organizationId } },
    {
      "@type": "WebApplication",
      "@id": `${homeUrl}#app`,
      name: siteName,
      url: homeUrl,
      description: publicPages["/"].description,
      applicationCategory: "BusinessApplication",
      publisher: { "@id": organizationId },
    },
  ],
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <HomeSessionGate><LandingPage /></HomeSessionGate>
    </>
  );
}
