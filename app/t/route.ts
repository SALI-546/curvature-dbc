/**
 * Token metadata, served by the app itself.
 *
 * createPool takes a metadata `uri` and our configs set tokenAuthorityOption: Immutable,
 * so whoever controls that URL controls the token's name, symbol and image forever. The
 * reference script pointed at curvestudio.xyz — a domain nobody owns — which would have
 * handed every token ever launched with Curvature to the first person to register it.
 *
 * Serving it from our own origin keeps control where the launcher is, needs no paid
 * storage, and is stateless: the response is derived entirely from the query string.
 */
import { NextResponse } from 'next/server'

const clean = (v: string | null, max: number) =>
  (v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)

export function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const symbol = clean(q.get('s'), 12)
  const name = clean(q.get('n'), 40) || symbol

  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 })
  }

  return NextResponse.json(
    {
      name,
      symbol,
      description: `${name} — launched with Curvature on Meteora's Dynamic Bonding Curve.`,
      image: '',
      external_url: 'https://github.com/SALI-546/curvature-dbc',
      attributes: [],
    },
    { headers: { 'cache-control': 'public, max-age=31536000, immutable' } }
  )
}
