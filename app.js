(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("c");
  const ctx = canvas.getContext("2d");

  // UI
  const refBtns = $("refBtns");
  const refLabel = $("refLabel");
  const tLabel = $("tLabel");
  const zLabel = $("zLabel");
  const vLabel = $("vLabel");
  const playBtn = $("playBtn");
  const resetBtn = $("resetBtn");
  const tRange = $("tRange");

  const speedBtns = {1:$("speed1"),5:$("speed5"),20:$("speed20"),100:$("speed100")};
  const zoomBtns  = {1:$("zoom1"),2:$("zoom2"),4:$("zoom4"),8:$("zoom8")};

  // Période : décollage Terre -> atterrissage comète (Philae)
  const DATE0 = new Date("2004-03-02T00:00:00Z").getTime();
  const DATE1 = new Date("2014-11-12T00:00:00Z").getTime();
  const YEAR = 365.25 * 24 * 3600 * 1000;

  function lerp(a,b,t){ return a + (b-a)*t; }
  function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }

  // Terre : cercle 1 AU (pédagogique)
  function earthPos(ms){
    const theta = 2*Math.PI * ((ms - DATE0) / YEAR);
    return [Math.cos(theta), Math.sin(theta)];
  }

  // Soleil : origine
  function sunPos(_ms){ return [0,0]; }

  // Comète 67P : ellipse pédagogique (non éphémérides)
  const aC = 3.46, eC = 0.64;
  const bC = aC * Math.sqrt(1 - eC*eC);
  const PC = 6.44 * YEAR;
  const PHASE_C = 0.9;

  function cometPos(ms){
    const M = 2*Math.PI * ((ms - DATE0) / PC);
    const E = M; // simplification
    const x = aC*(Math.cos(E) - eC);
    const y = bC*Math.sin(E);
    const ang = PHASE_C;
    return [x*Math.cos(ang) - y*Math.sin(ang), x*Math.sin(ang) + y*Math.cos(ang)];
  }

  // Waypoints mission (repères pédagogiques)
  const WP = [
    ["2004-03-02", "EARTH"],
    ["2005-03-04", "EARTH"],
    ["2007-02-25", "MARS-LIKE"],
    ["2007-11-13", "EARTH"],
    ["2009-11-13", "EARTH"],
    ["2014-08-06", "COMET"],
    ["2014-11-12", "COMET"]
  ].map(([ds, kind]) => ({ t: new Date(ds+"T00:00:00Z").getTime(), kind }));

  const rosettaPts = WP.map(w => {
    if (w.kind === "EARTH") return earthPos(w.t);
    if (w.kind === "COMET") return cometPos(w.t);
    // "Mars-like" : point plus près du Soleil pour mimer un GA Mars
    const p = earthPos(w.t);
    const ang = Math.atan2(p[1], p[0]) + 0.35;
    return [0.7*Math.cos(ang), 0.7*Math.sin(ang)];
  });

  function catmullRom(p0,p1,p2,p3,t){
    const t2=t*t, t3=t2*t;
    return [
      0.5*(2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
      0.5*(2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
    ];
  }

  function rosettaPos(ms){
    if (ms <= WP[0].t) return rosettaPts[0];
    if (ms >= WP[WP.length-1].t) return rosettaPts[rosettaPts.length-1];

    let i=0;
    for (; i<WP.length-1; i++){
      if (ms >= WP[i].t && ms <= WP[i+1].t) break;
    }
    const t = (ms - WP[i].t) / (WP[i+1].t - WP[i].t);

    const p0 = rosettaPts[Math.max(0,i-1)];
    const p1 = rosettaPts[i];
    const p2 = rosettaPts[i+1];
    const p3 = rosettaPts[Math.min(rosettaPts.length-1,i+2)];
    return catmullRom(p0,p1,p2,p3,t);
  }

  // Référentiels
  const REFS = [
    { id:"ROSETTA", label:"Référentiel : Rosetta" },
    { id:"EARTH",   label:"Référentiel : Terre"   },
    { id:"SUN",     label:"Référentiel : Soleil"  },
    { id:"COMET",   label:"Référentiel : Comète"  },
  ];

  const COLORS = {
    ROSETTA:"#e5e7eb",
    EARTH:"#60a5fa",
    SUN:"#fbbf24",
    COMET:"#a7f3d0"
  };

  let ref = "ROSETTA";
  let zoom = 1;
  let speed = 1;
  let playing = false;
  let u = 0; // 0..1
  let lastTs = 0;

  // Trajectoires "dessinées" (stockées), pour pouvoir les effacer au Reset
  const bodies = ["SUN","EARTH","COMET","ROSETTA"];
  const trails = Object.fromEntries(bodies.map(b => [b, []]));
  let lastTrailU = -1;

  function clearTrails(){
    for (const b of bodies) trails[b].length = 0;
    lastTrailU = -1;
  }

  function msFromU(u){
    return lerp(DATE0, DATE1, clamp(u,0,1));
  }
  function isoDate(ms){
    return new Date(ms).toISOString().slice(0,10);
  }

  function bodyPos(body, ms){
    if (body==="SUN") return sunPos(ms);
    if (body==="EARTH") return earthPos(ms);
    if (body==="COMET") return cometPos(ms);
    if (body==="ROSETTA") return rosettaPos(ms);
    return [0,0];
  }

  function rel(body, ms){
    const p = bodyPos(body, ms);
    const o = bodyPos(ref, ms);
    return [p[0]-o[0], p[1]-o[1]];
  }

  function pushTrailPoint(){
    // échantillonnage en u (évite trop de points)
    if (Math.abs(u - lastTrailU) < 0.0015) return;
    lastTrailU = u;

    const ms = msFromU(u);
    for (const b of bodies){
      const [x,y] = rel(b, ms);
      trails[b].push([x,y]);
      if (trails[b].length > 1600) trails[b].shift();
    }
  }

  function setRef(r){
    ref = r;
    [...refBtns.querySelectorAll("button")].forEach(b => b.classList.toggle("active", b.dataset.ref===r));
    refLabel.textContent = r;
    // ancien tracé incompatible avec nouveau référentiel -> on efface
    clearTrails();
    draw();
  }

  function setZoom(z){
    zoom = z;
    zLabel.textContent = z + "×";
    Object.entries(zoomBtns).forEach(([k,btn]) => btn.classList.toggle("active", +k===z));
    draw();
  }

  function setSpeed(s){
    speed = s;
    vLabel.textContent = "×" + s;
    Object.entries(speedBtns).forEach(([k,btn]) => btn.classList.toggle("active", +k===s));
  }

  function setPlaying(p){
    playing = p;
    playBtn.textContent = playing ? "⏸" : "▶︎";
  }

  function resetAll(){
    setPlaying(false);
    u = 0;
    tRange.value = 0;
    clearTrails(); // ✅ efface les trajectoires
    draw();
  }

  function makeButtons(){
    refBtns.innerHTML = "";
    for (const r of REFS){
      const b = document.createElement("button");
      b.textContent = r.label;
      b.dataset.ref = r.id;
      b.onclick = () => setRef(r.id);
      refBtns.appendChild(b);
    }
    setRef("ROSETTA");
  }

  function draw(){
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle="#000";
    ctx.fillRect(0,0,w,h);

    const cx=w/2, cy=h/2;
    const pxPerAU = 170 * zoom;

    // grille légère
    ctx.strokeStyle="rgba(255,255,255,.06)";
    ctx.lineWidth=1;
    for (let x=0; x<=w; x+=70){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for (let y=0; y<=h; y+=70){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

    // axes centre
    ctx.strokeStyle="rgba(255,255,255,.22)";
    ctx.beginPath();
    ctx.moveTo(cx-12,cy); ctx.lineTo(cx+12,cy);
    ctx.moveTo(cx,cy-12); ctx.lineTo(cx,cy+12);
    ctx.stroke();

    const ms = msFromU(u);
    tLabel.textContent = isoDate(ms);

    // trajectoires stockées
    for (const body of bodies){
      const tr = trails[body];
      if (tr.length >= 2){
        ctx.strokeStyle = COLORS[body];
        ctx.lineWidth = body==="ROSETTA" ? 2.5 : 2.0;
        ctx.beginPath();
        for (let i=0;i<tr.length;i++){
          const [x,y] = tr[i];
          const X = cx + x*pxPerAU;
          const Y = cy - y*pxPerAU;
          if (i===0) ctx.moveTo(X,Y); else ctx.lineTo(X,Y);
        }
        ctx.stroke();
      }
    }

    // positions courantes + labels
    for (const body of bodies){
      const [x,y] = rel(body, ms);
      const X = cx + x*pxPerAU;
      const Y = cy - y*pxPerAU;

      ctx.fillStyle = COLORS[body];
      ctx.beginPath();
      ctx.arc(X,Y, body===ref ? 7 : (body==="ROSETTA" ? 5 : 4), 0, Math.PI*2);
      ctx.fill();

      ctx.font = "14px system-ui,Segoe UI,Roboto,Arial";
      ctx.fillText(body, X+8, Y-8);
    }

    // titre
    ctx.fillStyle="rgba(255,255,255,.88)";
    ctx.font="16px system-ui,Segoe UI,Roboto,Arial";
    ctx.fillText("Relativité du mouvement — trajectoires relatives (simplifiée)", 16, 26);


    // --- Signature ---
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "13px system-ui,Segoe UI,Roboto,Arial";
    ctx.textAlign = "right";
    ctx.fillText(
      "Virginie Fourcassier. Lycée Pierre de Fermat. Toulouse",
      canvas.width - 16,
      canvas.height - 14
    );
    ctx.textAlign = "left";
    
  }

  function tick(ts){
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;

    if (playing){
      const base = 1/1600; // fraction timeline / s à ×1
      u += (dt/1000) * base * speed;
      if (u > 1) { u = 1; setPlaying(false); }
      tRange.value = Math.round(u*1000);

      pushTrailPoint();
      draw();
    }
    requestAnimationFrame(tick);
  }

  // wiring
  playBtn.onclick = () => setPlaying(!playing);
  resetBtn.onclick = () => resetAll();

  tRange.addEventListener("input", () => {
    // un "scrub" est un nouveau départ visuel
    setPlaying(false);
    u = (+tRange.value)/1000;
    clearTrails();
    draw();
  });

  Object.entries(speedBtns).forEach(([k,btn]) => btn.onclick = () => setSpeed(+k));
  Object.entries(zoomBtns).forEach(([k,btn]) => btn.onclick = () => setZoom(+k));

  // init
  makeButtons();
  setZoom(1);
  setSpeed(1);
  resetAll();
  requestAnimationFrame(tick);
})();
