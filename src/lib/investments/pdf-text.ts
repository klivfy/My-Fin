import { extractText, getDocumentProxy } from "unpdf";
import { PDF_NEEDS_PASSWORD, PDF_WRONG_PASSWORD } from "./messages";

export class PdfError extends Error {}

/**
 * Texto de cada página do PDF, uma linha por linha visual. A senha (notas
 * do BTG costumam vir protegidas) é usada só nesta leitura e não é guardada.
 */
export async function extractPdfPages(data: Uint8Array, password?: string): Promise<string[]> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data), password ? { password } : {});
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === "PasswordException") {
      throw new PdfError(password ? PDF_WRONG_PASSWORD : PDF_NEEDS_PASSWORD);
    }
    throw new PdfError("Não consegui abrir o PDF. Confira se é a nota de corretagem original.");
  }
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    return text;
  } finally {
    await pdf.cleanup?.();
  }
}
