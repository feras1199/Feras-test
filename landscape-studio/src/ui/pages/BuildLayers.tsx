import { useDerived, useStore } from '../../store/useStore.ts';
import { assemblies, type Assembly } from '../../core/layers.ts';
import { Banner, Empty } from '../kit.tsx';

const BADGE = { verified: ['ok', 'Verified'], assumed: ['warn', 'Assumed'], review: ['danger', 'Review required'] } as const;

/** Exploded layer stack drawn from the assembly, top layer first. Diagram only, not to scale. */
function Stack({ a }: { a: Assembly }) {
  const ls = a.layers.filter(l => l.fill !== 'none');
  let y = 6;
  const rows = ls.map(l => { const h = Math.max(18, Math.min(46, (l.thicknessMm ?? 40) / 2.5)); const r = { l, y, h }; y += h + 10; return r; });
  return <svg viewBox={`0 0 220 ${y}`} style={{ width: '100%', maxWidth: 260 }} role="img" aria-label={`Exploded build-up of ${a.title}`}>
    {rows.map(({ l, y: yy, h }) => <g key={l.name}>
      <polygon points={`16,${yy} 214,${yy} 204,${yy + h} 6,${yy + h}`} fill={l.fill} stroke="#374151" strokeWidth="1" />
      <text x="110" y={yy + h / 2 + 4} textAnchor="middle" fontSize="10.5" fill="#17202a" stroke="#ffffffcc" strokeWidth="2.5" paintOrder="stroke">{l.name}{l.thicknessMm ? ` · ${Math.round(l.thicknessMm)} mm` : ''}</text>
    </g>)}
  </svg>;
}

export function BuildLayers() {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const list = assemblies(p, d.lines, s.materials);
  if (!list.length) return <Empty title="No buildable elements yet"><p>Paving, turf, garden beds and retaining walls get a build-up here once they are in the design.</p></Empty>;
  return <>{list.map(a => <div className="card" key={a.objectId} data-testid={`layers-${a.objectId}`}>
    <div className="row between"><h2 style={{ margin: 0 }}>{a.title}</h2><span className={`badge ${a.concept ? 'warn' : 'ok'}`}>{a.concept ? 'Concept / not for construction' : 'Engineer input recorded'}</span></div>
    {a.banner && <div style={{ marginTop: 8 }}><Banner kind="danger">{a.banner}</Banner></div>}
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 240px) minmax(0, 1fr)', marginTop: 10, alignItems: 'start' }}>
      <Stack a={a} />
      <div className="tablewrap"><table><thead><tr><th>Layer</th><th>Product</th><th className="num">Quantity</th><th>Source</th><th>Status</th><th>Crew instruction</th></tr></thead><tbody>
        {a.layers.map(l => <tr key={l.name}><td><b>{l.name}</b><br /><small>{l.purpose}</small></td><td>{l.product}</td><td className="num">{l.qty}</td><td><small>{l.source}</small></td>
          <td><span className={`badge ${BADGE[l.status][0]}`}>{BADGE[l.status][1]}</span></td>
          <td>{l.instruction}{l.hold && <><br /><span className="badge danger">HOLD</span> <small>{l.hold}</small></>}</td></tr>)}
      </tbody></table></div>
    </div>
    <small>Exploded diagram, not to scale. Quantities come from the same take-off as the estimate and purchase list.</small>
  </div>)}</>;
}
