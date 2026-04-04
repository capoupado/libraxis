import { MarkdownView } from "../components/markdown-view.js";
import HOW_TO_MARKDOWN from "../../../docs/how-to.md?raw";

export function HowToPage() {
  return (
    <section>
      <h2>How-To</h2>
      <MarkdownView markdown={HOW_TO_MARKDOWN} />
    </section>
  );
}
