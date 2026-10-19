// Official CAMS / KFintech (Karvy) / Stallion forms. The catalogue lives in data/official_forms.json on the API
// (also read by universal search), so a form added there shows up here and in search with no frontend change.
export interface OfficialForm {
  title: string;
  source: "CAMS" | "KFintech" | "Stallion";
  category: string;
  kind: "PDF" | "Page";
  url: string;
  keywords: string;
}
