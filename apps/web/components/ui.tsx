'use client';
import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { X, LoaderCircle, ArrowUpRight, PackageOpen } from 'lucide-react';

export const money = (minor: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
export const date = (value: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(value));
export const words = (value: string) => value.replaceAll('_', ' ');
export const dayInput = (offset = 1) => { const d = new Date(Date.now() + offset * 86400000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function StateBadge({ status }: { status: string }) { return <Badge tone={['cancelled', 'recalled', 'exception', 'rejected', 'refunded', 'excursion'].includes(status) ? 'red' : ['pending', 'pending_confirmation', 'unpaid', 'draft', 'open', 'scheduled'].includes(status) ? 'amber' : 'green'}>{words(status)}</Badge>; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><PackageOpen size={36} strokeWidth={1.3}/><h3>{title}</h3><p>{children || 'New activity will appear here.'}</p></div>; }
export function Loading() { return <div className="loading" role="status"><LoaderCircle className="spin" size={24}/> Loading your workspace…</div>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Metric({ label, value, note, icon }: { label: string; value: ReactNode; note: string; icon: ReactNode }) { return <div className="metric"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong>{value}</strong><small>{note}</small></div>; }
export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) { return <div className="section-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; const dialog = ref.current; dialog?.showModal(); document.body.style.overflow = 'hidden'; return () => { dialog?.close(); document.body.style.overflow = ''; previous?.focus(); }; }, []);
  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
    if (!controls.length) return;
    event.preventDefault();
    const index = controls.indexOf(document.activeElement as HTMLElement);
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
  }
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby="modal-title" onKeyDown={trapFocus} onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}><div className="modal-head"><div><span className="eyebrow">HARVESTLINK WORKSPACE</span><h2 id="modal-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={21}/></button></div><div className="modal-body">{children}</div></dialog>;
}
export function Submit({ busy, children = 'Save changes' }: { busy: boolean; children?: ReactNode }) { return <button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin"/> : <ArrowUpRight size={17}/>} {busy ? 'Saving…' : children}</button>; }
