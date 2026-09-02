import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const runtime = 'nodejs';

export async function GET() {
  const file = await readFile(join(process.cwd(), 'public', 'whitepaper-v1.pdf'));

  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="MEERA-Conscious-Intelligence-CI.pdf"',
      'Content-Length': String(file.byteLength),
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
