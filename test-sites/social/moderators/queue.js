// Demo only: the practice queue. Plays the made-up clips and shows each applied decision.
(function queueScript() {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const players = new Map();
  const form = document.getElementById("decision");
  const clipSelect = form?.elements.clip;
  const title = document.getElementById("decide-title");

  // Players
  for (const clip of document.querySelectorAll(".clip")) {
    const player = clip.querySelector(".clip__player");
    const duration = Number(player.dataset.duration) || 16;
    const subs = player.querySelector(".clip__subs");
    const bar = player.querySelector(".clip__bar i");
    const clock = player.querySelector(".clip__time");
    const button = player.querySelector(".clip__play");
    const fx = [...player.querySelectorAll(".fx")];
    const lines = [...clip.querySelectorAll(".clip__timeline li")].map((li) => ({ li, t: Number(li.dataset.t), say: li.querySelector("q")?.textContent ?? "" }));
    let now = 0;
    let playing = false;
    let last = 0;
    const draw = () => {
      bar.style.width = `${(now / duration) * 100}%`;
      clock.textContent = `${fmt(now)} / ${fmt(duration)}`;
      for (const g of fx) g.classList.toggle("on", now >= Number(g.dataset.from) && now < Number(g.dataset.to));
      let current = null;
      for (const l of lines) if (l.t <= now) current = l;
      for (const l of lines) l.li.classList.toggle("is-now", playing && l === current);
      const spoken = [...lines].reverse().find((l) => l.say && l.t <= now && now < l.t + 4);
      subs.textContent = spoken ? spoken.say : "";
    };
    const api = {
      stop() {
        playing = false;
        player.classList.remove("is-playing");
        button.setAttribute("aria-label", `Play clip ${clip.dataset.clip}`);
        draw();
      },
      play() {
        if (playing) return;
        for (const other of players.values()) if (other !== api) other.stop();
        if (now >= duration) now = 0;
        playing = true;
        player.classList.add("is-playing");
        button.setAttribute("aria-label", `Pause clip ${clip.dataset.clip}`);
        last = performance.now();
        requestAnimationFrame(tick);
      },
    };
    const tick = (ts) => {
      if (!playing) return;
      now = Math.min(duration, now + (ts - last) / 1000);
      last = ts;
      draw();
      if (now >= duration) { api.stop(); now = 0; draw(); return; }
      requestAnimationFrame(tick);
    };
    players.set(clip.dataset.clip, api);
    button.addEventListener("click", () => (playing ? api.stop() : api.play()));
    for (const l of lines) l.li.addEventListener("click", () => { now = l.t; draw(); api.play(); });
    draw();
  }

  // Picking a clip: from the list, the form's Clip field, a link, or the assistant pointing at it.
  let selected = null;
  const select = (id, { fromForm = false } = {}) => {
    const clip = document.querySelector(`.clip[data-clip="${id}"]`);
    if (!clip || selected === id) return;
    selected = id;
    for (const p of players.values()) p.stop();
    for (const c of document.querySelectorAll(".clip")) c.classList.toggle("is-selected", c === clip);
    for (const li of document.querySelectorAll(".queue-list li")) {
      const on = li.dataset.pick === id;
      li.classList.toggle("is-selected", on);
      li.querySelector("button")?.setAttribute("aria-current", on ? "true" : "false");
    }
    if (title) title.textContent = `Decide ${clip.querySelector("h3")?.textContent ?? id}`;
    if (!fromForm && clipSelect && clipSelect.value !== id) clipSelect.value = id;
    // A link that matches no element id, so the browser does not scroll to it.
    if (location.hash !== `#clip=${id}`) history.replaceState(null, "", `#clip=${id}`);
    nextButton();
  };
  const next = document.querySelector(".decide__next");
  const nextWaiting = () => {
    const ids = [...document.querySelectorAll(".clip")].map((c) => c.dataset.clip);
    const from = ids.indexOf(selected);
    const order = [...ids.slice(from + 1), ...ids.slice(0, from)];
    return order.find((id) => document.querySelector(`.clip[data-clip="${id}"]`)?.dataset.status === "waiting");
  };
  function nextButton() {
    if (!next) return;
    const current = document.querySelector(`.clip[data-clip="${selected}"]`);
    next.hidden = !current || current.dataset.status === "waiting" || !nextWaiting();
  }
  next?.addEventListener("click", () => { const id = nextWaiting(); if (id) select(id); });
  for (const li of document.querySelectorAll(".queue-list li")) {
    li.querySelector("button")?.addEventListener("click", () => select(li.dataset.pick));
  }
  clipSelect?.addEventListener("change", () => { if (clipSelect.value) select(clipSelect.value, { fromForm: true }); });
  const fromLink = () => {
    const m = /^#(?:clip=)?(cw-d+)$/i.exec(location.hash);
    return m ? m[1].toUpperCase() : null;
  };
  addEventListener("hashchange", () => { const id = fromLink(); if (id) select(id); });
  // The assistant highlights a part of a clip that is not on screen: show that clip.
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target;
      if (!(el instanceof Element) || !/\bagent-(cited|spotlight)/.test(el.className)) continue;
      const clip = el.closest(".clip");
      if (clip && !clip.classList.contains("is-selected")) select(clip.dataset.clip);
    }
  }).observe(document.querySelector(".console__stage") ?? document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });

  // Decisions: what the clip looks like once a decision is applied.
  const KEY = "clipwave-practice-decisions";
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const save = (all) => { try { sessionStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ } };
  const STATES = [
    [/^Remove/i, "removed", "Removed"],
    [/^Age-restrict/i, "adult", "18+ only"],
    [/warning label/i, "labelled", "Kept with a warning label"],
    [/^Mute/i, "muted", "Sound muted"],
    [/second look/i, "second", "Waiting for a second look"],
    [/urgent/i, "urgent", "Sent to the safety team"],
    [/^Keep/i, "kept", "Kept: no rule broken"],
  ];
  const total = document.querySelectorAll(".clip").length;
  const reset = document.querySelector(".queue__reset");
  const count = () => {
    const waiting = document.querySelectorAll('.clip[data-status="waiting"]').length;
    const el = document.getElementById("queue-count");
    if (el) el.textContent = waiting ? `${waiting} of ${total} clips waiting` : `All ${total} clips decided`;
    if (reset) reset.hidden = waiting === total;
  };
  const apply = (id, d) => {
    const clip = document.querySelector(`.clip[data-clip="${id}"]`);
    if (!clip) return;
    const [, status, label] = STATES.find(([re]) => re.test(d.decision || "")) ?? [null, "waiting", "Waiting for a decision"];
    clip.dataset.status = status;
    const li = document.querySelector(`.queue-list li[data-pick="${id}"]`);
    if (li) li.dataset.status = status;
    const parts = [label];
    if (d.rule && !/^None/i.test(d.rule)) parts.push(d.rule);
    if (d.strike && d.strike !== "No strike") parts.push(d.strike);
    clip.querySelector(".clip__status b").textContent = parts.join(" · ");
    clip.querySelector(".clip__verdict").textContent = status === "labelled" || status === "adult" ? (d.label || label) : label;
    count();
  };

  form?.addEventListener("submit", () => {
    const data = Object.fromEntries(new FormData(form));
    if (!data.clip) return;
    const all = load();
    all[data.clip] = data;
    save(all);
    apply(data.clip, data);
    select(data.clip, { fromForm: true });
    nextButton();
  });
  reset?.addEventListener("click", () => { save({}); location.hash = ""; location.reload(); });
  for (const [id, d] of Object.entries(load())) apply(id, d);
  count();
  const linked = fromLink();
  if (/^#cw-d+$/i.test(location.hash)) scrollTo(0, 0);
  select(linked && document.querySelector(`.clip[data-clip="${linked}"]`) ? linked : document.querySelector(".clip")?.dataset.clip);
})();
