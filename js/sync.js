/* sync.js — Sync Engine Kastriva-DriveVault.
   Mode: "local2cloud" | "cloud2local" | "twoway"
   Prinsip: TIDAK PERNAH menimpa tanpa pengecekan.
   Konflik -> ditahan untuk review via MMConflicts (bukan auto keep-both).
   Namespace: window.MM.sync */
(function () {
  'use strict';
  const MM = window.MM;

  function now() { return new Date().toISOString(); }

  function isNewer(a, b) {
    if (!b) return true;
    const ta = Date.parse(a.modified || 0) || 0;
    const tb = Date.parse(b.modified || 0) || 0;
    if (ta !== tb) return ta > tb;
    return (a.version || 0) > (b.version || 0);
  }
  function sameContent(a, b) {
    if (a && b && a.type === 'folder' && b.type === 'folder') return a.name === b.name;
    return a && b && a.size === b.size &&
      (a.hash ? a.hash === b.hash : Date.parse(a.modified) === Date.parse(b.modified));
  }

  function sortParentFirst(ids, entries) {
    const keyOf = (e) => e.syncKey || e.id;
    const byId = new Map(entries.map((e) => [e.id, e]));
    const depth = (entry) => {
      let value = 0;
      let parentId = entry && entry.parentId;
      const seen = new Set();
      while (parentId && parentId !== 'root' && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        value++;
        parentId = parent.parentId;
      }
      return value;
    };
    const order = new Map(ids.map((id, index) => [id, index]));
    return [...ids].sort((left, right) => depth(entries.find((e) => keyOf(e) === left)) - depth(entries.find((e) => keyOf(e) === right)) || order.get(left) - order.get(right));
  }

  function resolveTargetParent(parentId, sourceEntries, targetEntries) {
    if (!parentId || parentId === 'root') return 'root';
    const sourceParent = sourceEntries.find((entry) => entry.id === parentId || entry.syncKey === parentId);
    const key = sourceParent ? (sourceParent.syncKey || sourceParent.id) : parentId;
    const targetParent = targetEntries.find((entry) => entry.id === key || entry.syncKey === key);
    return targetParent ? targetParent.id : parentId;
  }

  /* Rencana sync: pushes/pulls/deletes + conflicts (ditahan utk review). */
  function plan(localEntries, cloudEntries, mode) {
    const keyOf = (e) => e.syncKey || e.id;
    const L = new Map(localEntries.map((e) => [keyOf(e), e]));
    const C = new Map(cloudEntries.map((e) => [keyOf(e), e]));
    const out = { pushes: [], pulls: [], conflicts: [], deletes: { local: [], cloud: [] }, unchanged: 0 };
    const ids = new Set([...L.keys(), ...C.keys()]);
    for (const id of ids) {
      const l = L.get(id);
      const c = C.get(id);
      if (l && c) {
        if (sameContent(l, c) && l.deleted === c.deleted) { out.unchanged++; continue; }
        if (l.deleted !== c.deleted) {
          // delete vs edit: jika sisi yang masih ada LEBIH BARU dari penghapusan -> konflik
          const d = l.deleted ? l : c;
          const e = l.deleted ? c : l;
          if (mode === 'twoway' && isNewer(e, d)) {
            out.conflicts.push({ id, winner: 'both', side: 'both', le: l, ce: c, kind: 'delete-edit' });
          } else if (mode === 'local2cloud' && l.deleted) {
            out.deletes.cloud.push(id);
          } else if (mode === 'cloud2local' && c.deleted) {
            out.deletes.local.push(id);
          } else if (mode === 'local2cloud' && !l.deleted) {
            out.pushes.push(id);
          } else if (mode === 'cloud2local' && !c.deleted) {
            out.pulls.push(id);
          } else {
            if (isNewer(l, c)) out.deletes.cloud.push(id); else out.deletes.local.push(id);
          }
          continue;
        }
        if (mode === 'local2cloud') {
          if (isNewer(l, c)) out.pushes.push(id);
          else out.conflicts.push({ id, winner: 'cloud', side: 'cloud', le: l, ce: c, kind: 'edit-edit' });
        } else if (mode === 'cloud2local') {
          if (isNewer(c, l)) out.pulls.push(id);
          else out.conflicts.push({ id, winner: 'local', side: 'local', le: l, ce: c, kind: 'edit-edit' });
        } else { // twoway
          if (isNewer(l, c)) out.pushes.push(id);
          else if (isNewer(c, l)) out.pulls.push(id);
          else out.conflicts.push({ id, winner: 'both', side: 'both', le: l, ce: c, kind: 'edit-edit' });
        }
      } else if (l) {
        if (mode === 'cloud2local') out.deletes.local.push(id);
        else out.pushes.push(id);
      } else {
        if (mode === 'local2cloud') out.deletes.cloud.push(id);
        else out.pulls.push(id);
      }
    }
    out.pushes = sortParentFirst(out.pushes, localEntries);
    out.pulls = sortParentFirst(out.pulls, cloudEntries);
    return out;
  }

  function conflictName(name, fromSide) {
    const dot = String(name).lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    return `${base} (konflik dari ${fromSide})${ext}`;
  }

  function localCopyName(name, timestamp) {
    const dot = String(name).lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const suffix = timestamp ? ` (Local Copy ${timestamp})` : ' (Local Copy)';
    return `${base}${suffix}${ext}`;
  }

  /*
   * opts.automated: true = jangan buka UI review (hanya catat konflik + log).
   * Konflik: MMConflicts.record(...) -> ditunggu user memilih di panel Conflicts.
   * copyEntry tetap tersedia untuk resolusi "Keduanya".
   */
  async function run(opts = {}) {
    const mode = opts.mode || 'twoway';
    const log = [];
    const say = (m) => { log.push(m); if (opts.onLog) opts.onLog(m); };
    const hasConflictStore = typeof window !== 'undefined' && window.MMConflicts;

    const local = await opts.getLocal();
    const cloud = await opts.getCloud();
    const p = plan(local, cloud, mode);
    say(`Sync mode=${mode}: ${p.pushes.length} push, ${p.pulls.length} pull, ${p.conflicts.length} konflik, ${p.deletes.local.length + p.deletes.cloud.length} hapus, ${p.unchanged} sama.`);

    const keyOf = (e) => e.syncKey || e.id;
    const L = new Map(local.map((e) => [keyOf(e), e]));
    const C = new Map(cloud.map((e) => [keyOf(e), e]));

    for (const id of p.pushes) {
      const e = L.get(id);
      try { await opts.pushEntry(e); say(`PUSH ${e.name} -> cloud`); }
      catch (err) { say(`GAGAL PUSH ${e.name}: ${err.message}`); }
    }
    for (const id of p.pulls) {
      const e = C.get(id);
      try { await opts.pullEntry(e); say(`PULL ${e.name} -> lokal`); }
      catch (err) { say(`GAGAL PULL ${e.name}: ${err.message}`); }
    }

    for (const cf of p.conflicts) {
      const le = L.get(cf.id) || null;
      const ce = C.get(cf.id) || null;
      try {
        await window.MMConflicts.record(cf.id, le, ce);
        if (window.F) window.F.setStatus(cf.id, window.F.STATUS.CONFLICT);
        say(`KONFLIK ${cf.kind} pada "${(le || ce).name}": DITAHAN untuk review — tidak ada file diubah.`);
      } catch (err) {
        say(`KONFLIK ${cf.id}: gagal mencatat (${err.message}) — tidak ada file diubah.`);
      }
    }

    if (p.deletes.cloud.length) {
      try { await opts.deleteCloud(p.deletes.cloud); say(`Hapus di cloud: ${p.deletes.cloud.length} entri`); }
      catch (err) { say(`GAGAL hapus cloud: ${err.message}`); }
    }
    if (p.deletes.local.length) {
      try { await opts.deleteLocal(p.deletes.local); say(`Hapus di lokal: ${p.deletes.local.length} entri`); }
      catch (err) { say(`GAGAL hapus lokal: ${err.message}`); }
    }
    say('Sync selesai — konflik menunggu keputusan di panel Conflicts.');
    return { plan: p, log, pushed: p.pushes.length, pulled: p.pulls.length, conflicts: p.conflicts.length };
  }

  MM.sync = { plan, run, conflictName, localCopyName, isNewer, sameContent, resolveTargetParent };
  window.MM = MM;
})();
