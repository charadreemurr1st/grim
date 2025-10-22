// Undertale-like battle & text-RPG overhaul for Grim
// - interactive battle menu (Fight, Act, Item, Mercy)
// - ACT: multiple acts including CHECK and custom acts
// - items spawn/appear and can be used/picked up
// - bullet-hell 'fight' minigame remains but refined
// - mercy system and routes (pacifist / neutral / genocide)
// - save/load to localStorage
// - more polished UI hooks (works with existing HTML if present)

(() => {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) {
    console.warn('game-canvas not found in DOM — aborting game.js init');
    return;
  }
  const ctx = canvas.getContext('2d');
  const startBtn = document.getElementById('start-game');
  const resetBtn = document.getElementById('reset-game');
  const saveBtn = document.getElementById('save-game');
  const loadBtn = document.getElementById('load-game');
  const dbgEnc0 = document.getElementById('dbg-enc-0');
  const dbgEnc1 = document.getElementById('dbg-enc-1');
  const dbgEnc2 = document.getElementById('dbg-enc-2');
  const dbgHeal = document.getElementById('dbg-heal');
  const dbgItem = document.getElementById('dbg-add-item');
  const dialogueBox = document.getElementById('dialogue-box');
  const dialogueText = document.getElementById('dialogue-text');
  const nextBtn = document.getElementById('next-btn');
  const dialogueControls = document.getElementById('dialogue-controls');
  const stateLabel = document.getElementById('state-label');
  const hud = document.getElementById('hud');
  const battleUI = document.getElementById('battle-ui');
  const saveIndicator = document.getElementById('save-indicator');
  const actionButtons = document.querySelectorAll('.action');
  const enemyNameLabel = document.getElementById('enemy-name');
  const enemyHPFill = document.getElementById('enemy-hp');
  const playerHPFill = document.getElementById('player-hp');
  const combatLog = document.getElementById('combat-log');
  const actsList = document.getElementById('acts-list');
  const itemsList = document.getElementById('items-list');
  const menuInfo = document.getElementById('menu-info');

  // --- sound setup (reuse previous audioMap, allow for missing files) ---
  const audioMap = {
    'ui-click': 'snd/mo_pop.ogg',
    'start': 'snd/mail_jingle_alt.ogg',
    'fight-hit': 'snd/mo_pop.ogg',
    'act': 'snd/pinkgoo_move.ogg',
    'item': 'snd/clover_jump_dunes.ogg',
    'mercy-success': 'snd/mail_jingle_alt.ogg',
    'mercy-fail': 'snd/pops_deflate.ogg',
    'enemy-attack': 'snd/wild_east_shocking_sound.ogg',
    'player-hurt': 'snd/wood_zap.ogg',
    'victory': 'snd/microsprings_froggits.ogg',
    'gameover': 'snd/wood_flowey.ogg',
    'doorclose': 'snd/doorclose.ogg',
    'bg-exploration': 'snd/snowdin_bridge.ogg',
    'bg-battle': 'snd/sandstorm.ogg'
  };
  const baseAudio = {};
  function playSfx(name, opts = {}) {
    const url = audioMap[name];
    if (!url) return null;
    try {
      const base = baseAudio[name];
      if (base && !base.loop) {
        const node = base.cloneNode();
        node.volume = (opts.volume ?? 0.9);
        node.currentTime = 0;
        node.play().catch(()=>{});
        return node;
      }
      const a = new Audio(url);
      a.preload = 'auto';
      a.volume = (opts.volume ?? 0.9);
      a.play().catch(()=>{});
      return a;
    } catch (e) { return null; }
  }
  let currentMusic = null;
  function playMusic(name, opts = {}) {
    const url = audioMap[name]; if (!url) return;
    if (currentMusic && currentMusic._name === name && !currentMusic.paused) return;
    if (currentMusic) try { currentMusic.pause(); } catch (e) {}
    let a = baseAudio[name];
    if (!a) {
      a = new Audio(url);
      a.loop = true;
      a.preload = 'auto';
      a.volume = (opts.volume ?? 0.5);
      baseAudio[name] = a;
    }
    a._name = name;
    a.currentTime = opts.startTime || 0;
    a.play().catch(()=>{});
    currentMusic = a;
  }
  function stopMusic() { if (currentMusic) try { currentMusic.pause(); } catch(e) {} currentMusic = null; }
  Object.keys(audioMap).forEach(k => { try { const a = new Audio(audioMap[k]); a.preload='auto'; baseAudio[k]=a; } catch(e){} });

  // --- story & encounters ---
  const story = {
    intro: [
      "THE CHRONICLES OF GRIM GREASER",
      "You are Grim. A kid in Ridgewood High with a talent for trouble and snacks.",
      "The halls whisper. Something that doesn't belong is peeking through the cracks."
    ],
    hallway: [
      "* Zoey fusses about her papers. She's worried but trying to hold it together.",
      "* Zack is suspiciously close to the vending machine, plotting his next snack heist.",
      "Mia: Grim! I baked something for you... (the air feels a touch colder.)",
      "You can choose where to go: maybe the library or the hall."
    ],
    endingPacifist: [
      "You chose mercy and kindness. Ridgewood breathes easier.",
      "Pacifist ending — to be continued."
    ],
    endingGenocide: [
      "Your path left nothing behind. Silence answers.",
      "Genocide ending — consequences echo."
    ],
    endingNeutral: [
      "You survived, changed but uncertain.",
      "Neutral ending — the story goes on."
    ]
  };

  const baseEncounters = [
    {
      id: 'library-ghost',
      name: 'Library Ghost',
      maxHp: 50,
      hp: 50,
      attack: 10,
      defense: 3,
      exp: 25,
      mercyThreshold: 0.2, // percent
      acts: [
        { id: 'joke', label: 'Tell a joke', outcome: (e) => ({ text:`The ghost giggles. It seems calmer.`, mercy:true }) },
        { id: 'compliment', label: 'Compliment', outcome: (e) => ({ text:`It drifts closer, listening.`, mercy:false }) },
        { id: 'read', label: 'Read a book', outcome: (e) => ({ text:`You read aloud from a silly tale. The ghost seems comforted.`, mercy:true }) },
        { id: 'quiet', label: 'Be quiet', outcome: (e) => ({ text:`Silence settles — the ghost seems contemplative.`, mercy:false }) }
      ],
      dialog: ["A ghost drifts from the dusty shelves!"],
      flavor: "A lost student who can't find her notes."
    },
    {
      id: 'shadow-wraith',
      name: 'Shadow Wraith',
      maxHp: 80,
      hp: 80,
      attack: 14,
      defense: 6,
      exp: 40,
      mercyThreshold: 0.22,
      acts: [
        { id:'showlight', label:'Shine Light', outcome: (e) => ({ text:`You flash a light — the shadow recoils.`, mercy:false }) },
        { id:'humm', label:'Humm a tune', outcome:(e)=> ({ text:`The wraith seems distracted.`, mercy:true }) },
        { id:'poke', label:'Poke', outcome:(e)=> ({ text:`You poke the shadow. It sizzles and loses focus.`, mercy:false }) },
        { id:'taunt', label:'Taunt', outcome:(e)=> ({ text:`You throw a taunt. The wraith grows angrier — but you're more confident.`, mercy:false }) }
      ],
      dialog: ["A writhing shadow stalks you!", "It feeds on fear..."] ,
      flavor: "Something formed from forgotten anger."
    },
    {
      id: 'mia-boss',
      name: 'Mia',
      maxHp: 140,
      hp: 140,
      attack: 18,
      defense: 8,
      exp: 80,
      mercyThreshold: 0.28,
      acts: [
        { id:'talk', label:'Talk', outcome:(e)=> ({ text:`You talk to Mia about feelings. She falters.`, mercy:false }) },
        { id:'remin', label:'Reminisce', outcome:(e)=> ({ text:`A memory surfaces — Mia looks away.`, mercy:true }) },
        { id:'gift', label:'Offer snack', outcome:(e)=> ({ text:`You offer your snack. Mia is taken aback, then softens.`, mercy:true }) },
        { id:'apologize', label:'Apologize', outcome:(e)=> ({ text:`You apologize for past slights. Mia pauses, unsure.`, mercy:false }) }
      ],
      dialog: [
        "Mia: You can't avoid me forever, Grim!",
        "Mia: We are meant to be together."
      ],
      flavor: "An obsessive friend who refuses to let go."
    }
  ];

  // branching exploration map: each node has a description and available encounter indices
  const branches = {
    start: {
      desc: 'Hallway outside the classroom. Where will you go?',
      choices: [ { label: 'Library', encounter: 0 }, { label: 'Hallway', encounter: 1 }, { label: 'Skip class', encounter: null } ]
    }
  };

  let currentBranch = 'start';
  let rebellion = 0; // tracks skipping/class rebellion choices for route consequences

  // persist a working copy of encounters so we can reset per-save
  // We'll keep a lightweight copy of encounter states but reconstruct act functions from baseEncounters by id when loading
  let encounters = JSON.parse(JSON.stringify(baseEncounters));

  // player state
  const player = { maxHp:100, hp:100, level:1, exp:0, items: [ { id:'snack', name:'Snack', heal:20, qty:2 } ] };


  // route tracking
  let killsCount = 0;
  let mercyCount = 0;

  // game state machine
  let state = 'menu'; // menu | intro | exploration | battleStart | battle | victory | ending | gameover
  let currentDialogue = [];
  let dialogueIndex = 0;
  let currentEncounterIndex = 0;
  let enemy = null;
  let battlePhase = 'menu'; // menu | attackpattern | resolving
  let lastTime = 0;

  // soul (player heart)
  const soul = { x: canvas.width/2, y: canvas.height-140, size:18, speed:4 };
  const keys = {};
  let bullets = [];

  // UI helpers
  function setState(newState) {
    state = newState;
    if (stateLabel) stateLabel.textContent = state.toUpperCase();
    if (state === 'menu') {
      if (dialogueBox) dialogueBox.classList.add('hidden');
      if (battleUI) battleUI.classList.add('hidden');
      stopMusic();
    } else if (state === 'intro' || state === 'exploration' || state === 'victory' || state === 'ending' || state === 'gameover') {
      if (dialogueBox) dialogueBox.classList.remove('hidden');
      if (battleUI) battleUI.classList.add('hidden');
      if (state === 'exploration' || state === 'intro' || state === 'ending') playMusic('bg-exploration',{volume:0.45});
    } else if (state === 'battleStart') {
      if (dialogueBox) dialogueBox.classList.remove('hidden');
      if (battleUI) battleUI.classList.add('hidden');
    } else if (state === 'battle') {
      if (dialogueBox) dialogueBox.classList.add('hidden');
      if (battleUI) battleUI.classList.remove('hidden');
      playMusic('bg-battle',{volume:0.45});
      renderBattleMenu();
    }
  }

  function startIntro() { currentDialogue = [...story.intro]; dialogueIndex = 0; setState('intro'); updateDialogue(); playSfx('start'); }

  function updateDialogue() {
    if (!dialogueBox || !dialogueText) return;
    if (dialogueIndex < currentDialogue.length) {
      dialogueText.textContent = currentDialogue[dialogueIndex];
    } else {
      if (state === 'intro') { currentDialogue = [...story.hallway]; dialogueIndex=0; setState('exploration'); updateDialogue(); }
      else if (state === 'exploration') {
        // present choices the first time the exploration node finishes
        if (currentEncounterIndex === 0) {
          const node = branches[currentBranch];
          if (node && node.choices) {
            presentChoices(node.choices.map(c=>({ label: c.label, onChoose: ()=>{ if (c.encounter===null) { rebellion++; const idx = Math.random()<0.5?0:1; prepareEncounter(idx); } else { prepareEncounter(c.encounter); } } })));
          } else { prepareEncounter(currentEncounterIndex); }
        } else {
          prepareEncounter(currentEncounterIndex);
        }
      }
      else if (state === 'battleStart') { setState('battle'); startBattleLoop(); }
      else if (state === 'victory') { currentEncounterIndex++; if (currentEncounterIndex < encounters.length) { currentDialogue = ['After a short rest, you continue...']; dialogueIndex=0; setState('exploration'); updateDialogue(); } else { // ending by route
          decideEnding(); } }
      else if (state === 'ending' || state === 'gameover') { setState('menu'); }
    }
  }

  if (nextBtn) nextBtn.addEventListener('click', ()=>{ playSfx('ui-click'); dialogueIndex++; updateDialogue(); });
  if (startBtn) startBtn.addEventListener('click', ()=>{ playSfx('ui-click'); resetAll(); startIntro(); });
  if (resetBtn) resetBtn.addEventListener('click', ()=>{ playSfx('doorclose'); resetAll(); setState('menu'); });
  if (saveBtn) saveBtn.addEventListener('click', ()=>{ saveGame(); playSfx('ui-click'); });
  if (loadBtn) loadBtn.addEventListener('click', ()=>{ loadGame(); playSfx('ui-click'); });

  // debug wiring
  if (dbgEnc0) dbgEnc0.addEventListener('click', ()=>{ resetAll(); currentEncounterIndex = 0; prepareEncounter(0); });
  if (dbgEnc1) dbgEnc1.addEventListener('click', ()=>{ resetAll(); currentEncounterIndex = 1; prepareEncounter(1); });
  if (dbgEnc2) dbgEnc2.addEventListener('click', ()=>{ resetAll(); currentEncounterIndex = 2; prepareEncounter(2); });
  if (dbgHeal) dbgHeal.addEventListener('click', ()=>{ player.hp = player.maxHp; updatePlayerBar(); appendCombatLog('Healed to full.'); });
  if (dbgItem) dbgItem.addEventListener('click', ()=>{ const slot = player.items.find(i=>i.id==='snack'); if (slot) slot.qty++; else player.items.push({id:'snack',name:'Snack',heal:20,qty:1}); appendCombatLog('Added a Snack.'); });

  function prepareEncounter(idx) {
    enemy = JSON.parse(JSON.stringify(encounters[idx]));
    currentDialogue = enemy.dialog.slice();
    dialogueIndex = 0;
    setState('battleStart');
    updateDialogue();
    if (enemyHPFill) enemyHPFill.style.width = `${(enemy.hp/enemy.maxHp)*100}%`;
    if (playerHPFill) playerHPFill.style.width = `${(player.hp/player.maxHp)*100}%`;
    if (enemyNameLabel) enemyNameLabel.textContent = enemy.name.toUpperCase();
  }

  // simple choices UI for exploration
  function presentChoices(choices) {
    if (!dialogueBox || !dialogueText || !dialogueControls) return;
    // hide next button
    const next = document.getElementById('next-btn'); if (next) next.style.display='none';
    // create choice buttons container
    let container = document.getElementById('choice-container');
    if (!container) { container = document.createElement('div'); container.id='choice-container'; container.style.display='flex'; container.style.gap='8px'; container.style.marginTop='8px'; dialogueBox.appendChild(container); }
    container.innerHTML='';
    choices.forEach(c=>{
      const b = document.createElement('button'); b.className='btn'; b.textContent=c.label; b.addEventListener('click',()=>{ playSfx('ui-click'); container.innerHTML=''; if (next) next.style.display='inline-block'; c.onChoose(); }); container.appendChild(b);
    });
  }

  // helper: find base encounter by id (to reconstruct act functions)
  function findBaseEncounter(id) {
    return baseEncounters.find(e => e.id === id) || null;
  }

  // Action button wiring (Fight, Act, Item, Mercy) — existing buttons should have data-action
  actionButtons.forEach(btn => { btn.addEventListener('click', ()=>{ const act = btn.dataset.action; if (state !== 'battle' || battlePhase !== 'menu') return; playSfx('ui-click'); performAction(act); }); });

  function performAction(action) {
    appendCombatLog(`You chose: ${action.toUpperCase()}`);
    if (action === 'fight') { enterFightMinigame(); }
    else if (action === 'act') { openActMenu(); }
    else if (action === 'item') { openItemMenu(); }
    else if (action === 'mercy') { attemptMercy(); }
  }

  // ACT system
  function openActMenu() {
    if (!actsList || !menuInfo) return;
    actsList.innerHTML = '';
    menuInfo.textContent = 'Choose an ACT to try to befriend or weaken the enemy.';
    // Ensure enemy acts have functional outcomes — if we loaded from save they may be simple descriptors, so patch from baseEncounters
    const base = findBaseEncounter(enemy.id);
    const actsToUse = base && base.acts ? base.acts : enemy.acts;
    actsToUse.forEach(a => {
      const b = document.createElement('button');
      b.className = 'act-btn';
      b.textContent = a.label;
      b.addEventListener('click',()=>{
        playSfx('act');
        const out = (typeof a.outcome === 'function') ? a.outcome(enemy) : { text: a.note || 'It had an effect.', mercy:false };
        appendCombatLog(out.text);
        if (out.mercy) { enemy._canMercy = true; appendCombatLog(`${enemy.name} looks more merciful...`); }
        closeMenus();
        setTimeout(()=>{ startEnemyAttack(); }, 600);
      });
      actsList.appendChild(b);
    });
    // add CHECK act
    const checkBtn = document.createElement('button');
    checkBtn.className = 'act-btn check';
    checkBtn.textContent = 'CHECK';
    checkBtn.addEventListener('click',()=>{
      playSfx('ui-click');
      const info = `${enemy.name}: ${enemy.flavor} \nHP: ${enemy.hp}/${enemy.maxHp} \nAttack: ${enemy.attack}`;
      appendCombatLog(info);
      menuInfo.textContent = 'Check reveals info about the enemy.';
    });
    actsList.appendChild(checkBtn);
  }

  // Item menu
  function openItemMenu() {
    if (!itemsList || !menuInfo) return;
    itemsList.innerHTML = '';
    menuInfo.textContent = 'Choose an item to use or click item to pick up (if present).';
    player.items.forEach((it, idx)=>{
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.textContent = `${it.name} x${it.qty}`;
      b.addEventListener('click',()=>{
        if (it.qty <= 0) { appendCombatLog('No more of that item.'); return; }
        playSfx('item');
        if (it.id === 'shield') {
          // shield grants temporary defense boost for next enemy attack
          player._tempDef = (player._tempDef || 0) + 4;
          appendCombatLog('Used Shield: defense increased briefly.');
        } else {
          player.hp = Math.min(player.maxHp, player.hp + it.heal);
          appendCombatLog(`Used ${it.name}: +${it.heal} HP`);
        }
        it.qty--;
        updatePlayerBar();
        closeMenus();
        setTimeout(()=>{ startEnemyAttack(); }, 600);
      });
      itemsList.appendChild(b);
    });
  }
  function closeMenus() { if (actsList) actsList.innerHTML=''; if (itemsList) itemsList.innerHTML=''; if (menuInfo) menuInfo.textContent=''; }

  // Attempt mercy
  function attemptMercy() {
    playSfx('ui-click');
    const threshold = enemy.mercyThreshold || 0.25;
    const hpPercent = enemy.hp / enemy.maxHp;
    if (enemy._canMercy || hpPercent <= threshold) {
      playSfx('mercy-success');
      appendCombatLog(`${enemy.name} shows mercy and leaves.`);
      mercyCount++;
      onVictory(true);
    } else {
      playSfx('mercy-fail');
      appendCombatLog(`${enemy.name} refuses mercy!`);
      setTimeout(()=> startEnemyAttack(), 600);
    }
  }

  // Fight minigame — opens attack pattern where player tries to hit enemy with bullets (optional: keep simple)
  function enterFightMinigame() {
    // Enter a short attack window where player's soul can hit bullets to turn them into damage
    battlePhase = 'attackpattern';
    playSfx('fight-hit');
    appendCombatLog('You choose to FIGHT — move your SOUL to hit the glowing cores to deal damage.');
    bullets = [];
    const patternCount = 10 + Math.floor(enemy.attack/2);
    for (let i=0;i<patternCount;i++) {
      const angle = Math.random()*Math.PI*2;
      const speed = 1 + Math.random()*2.2;
      bullets.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height*0.6 + 40, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, r:6 + Math.random()*8, color:'#ff8888', hits:0 });
    }
    // fight runs for a short duration; during this time collisions are checked in drawScene
    const fightDuration = 1200 + Math.random()*800;
    const fightStart = performance.now();
    const fightTick = () => {
      const now = performance.now();
      // compute damage from bullets that were 'struck' by soul (we mark hits on bullets)
      if (now - fightStart >= fightDuration) {
        // count bullets that were hit
        const hitCount = bullets.reduce((s,b)=> s + (b._hit?1:0), 0);
        const rawDmg = 6 + Math.floor(Math.random()*18);
        const dmg = Math.max(1, rawDmg + hitCount - enemy.defense);
        enemy.hp = Math.max(0, enemy.hp - dmg);
        appendCombatLog(`You dealt ${dmg} damage! (${hitCount} hits)`);
        updateEnemyBar();
        bullets = [];
        battlePhase = 'menu';
        if (enemy.hp <= 0) { onVictory(false); }
        else { setTimeout(()=> startEnemyAttack(), 450); }
        return;
      }
      requestAnimationFrame(fightTick);
    };
    requestAnimationFrame(fightTick);
  }

  // Enemy attack patterns
  let attackActive = false;
  function startEnemyAttack() {
    if (!enemy) return;
    battlePhase = 'attackpattern';
    attackActive = true;
    playSfx('enemy-attack');
    bullets = [];
    const patternCount = Math.min(26, Math.floor(enemy.attack/2)+8);
    // create downward falling bullets and some radial bursts
    for (let i=0;i<patternCount;i++) {
      if (i % 5 === 0) {
        // radial burst from top-center
        const sx = canvas.width/2 + (Math.random()-0.5)*80;
        const sy = 60 + Math.random()*40;
        const spread = 6 + Math.floor(Math.random()*6);
        for (let j=0;j<spread;j++) {
          const angle = (j/spread)*Math.PI*2 + (Math.random()*0.4-0.2);
          const speed = 1.2 + Math.random()*2 + (enemy.attack/30);
          bullets.push({ x:sx, y:sy, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, r:6+Math.random()*6, color:'#ff4d4d' });
        }
      } else {
        const x = 40 + Math.random()*(canvas.width-80);
        const y = -20 - Math.random()*120;
        const tx = soul.x + (Math.random()-0.5)*120;
        const ty = soul.y - 40 + (Math.random()-0.5)*40;
        const angle = Math.atan2(ty - y, tx - x);
        const speed = 1.2 + Math.random()*2 + (enemy.attack/30);
        bullets.push({ x, y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, r:6+Math.random()*8, color:'#ff4d4d' });
      }
    }
    // run for a while — during this time collisions are checked each frame
    const start = performance.now();
    const duration = 1400 + Math.random()*900;
    const tick = () => {
      const now = performance.now();
      // check collisions and apply damage immediately for bullets that hit the soul
      for (let i=bullets.length-1;i>=0;i--) {
        const b = bullets[i];
        const dx=b.x - soul.x; const dy=b.y - soul.y; const d=Math.sqrt(dx*dx+dy*dy);
        if (d < b.r + soul.size) {
          // damage based on enemy.attack and bullet size, reduced by temporary defense
          const base = Math.max(1, Math.floor((enemy.attack/8) + (b.r/6)));
          const def = player._tempDef || 0;
          const dmg = Math.max(0, base - def);
          if (dmg > 0) {
            player.hp = Math.max(0, player.hp - dmg);
            playSfx('player-hurt'); appendCombatLog(`${enemy.name} hits you for ${dmg} HP.`);
            updatePlayerBar();
          } else {
            appendCombatLog('Your defense absorbed the hit!');
          }
          bullets.splice(i,1);
        }
      }
      if (now - start >= duration) {
  // end attack
  attackActive=false; battlePhase='menu'; bullets=[];
  // clear temporary defense now that attack ended
  if (player._tempDef) { player._tempDef = 0; appendCombatLog('Shield effect faded.'); }
        if (player.hp <= 0) {
          setTimeout(()=>{ setState('gameover'); playSfx('gameover'); currentDialogue = ['You fell down...','This is not necessarily the end.']; dialogueIndex=0; if (dialogueBox) dialogueBox.classList.remove('hidden'); if (battleUI) battleUI.classList.add('hidden'); }, 600);
          return;
        }
        // end of attack — resume menu
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function checkSoulCollisions() {
    // simulate collisions: count bullets close to soul
    let hits = 0;
    bullets.forEach(b=>{ const dx=b.x-soul.x; const dy=b.y-soul.y; const d=Math.sqrt(dx*dx+dy*dy); if (d < b.r + soul.size) hits++; });
    return Math.min(10,hits);
  }

  function onVictory(mercied=false) {
    if (mercied) {
      playSfx('mercy-success');
      appendCombatLog(`${enemy.name} has been spared.`);
    } else {
      playSfx('victory');
      appendCombatLog(`${enemy.name} defeated! You gain ${enemy.exp} EXP.`);
      killsCount++;
    }
    player.exp += enemy.exp;
    player.hp = Math.min(player.maxHp, player.hp + (mercied?8:12));
    // small level-up: every 100 EXP
    if (player.exp >= player.level * 100) {
      player.level++;
      player.maxHp += 10;
      player.hp = Math.min(player.maxHp, player.hp + 10);
      appendCombatLog(`LEVEL UP! You are now level ${player.level}. HP increased.`);
    }
    updatePlayerBar();
    setState('victory');
    currentDialogue = [ enemy.name + (mercied? ' fades away peacefully...' : ' collapses...') ];
    dialogueIndex = 0;
    if (dialogueBox) dialogueBox.classList.remove('hidden');
    if (battleUI) battleUI.classList.add('hidden');
  }

  function updateEnemyBar() { if (enemyHPFill) enemyHPFill.style.width = `${(enemy.hp/enemy.maxHp)*100}%`; }
  function updatePlayerBar() { if (playerHPFill) { const pct = Math.max(0, Math.min(1, player.hp / player.maxHp)); playerHPFill.style.width = `${pct*100}%`; } }
  function appendCombatLog(text) { if (!combatLog) return; combatLog.classList.remove('hidden'); const p=document.createElement('div'); p.textContent = `• ${text}`; p.style.fontFamily='"Press Start 2P", monospace'; p.style.fontSize='12px'; combatLog.appendChild(p); // limit lines
    while (combatLog.children.length > 120) combatLog.removeChild(combatLog.firstChild);
    combatLog.scrollTop = combatLog.scrollHeight; }

  // items that can appear on the battle field (pickups)
  let fieldItems = [];
  function spawnFieldItem(item) { // item: {id,name,heal}
    const fi = { ...item, x: 60 + Math.random()*(canvas.width-120), y: 80 + Math.random()*120, r:14 };
    fieldItems.push(fi);
    appendCombatLog(`An item appeared: ${item.name}. Click it to pick up.`);
  }

  canvas.addEventListener('click', (e)=>{
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    // pick up items
    for (let i=fieldItems.length-1;i>=0;i--) {
      const it = fieldItems[i]; const dx=mx-it.x; const dy=my-it.y; if (Math.sqrt(dx*dx+dy*dy) < it.r+6) { // pick
        playSfx('item');
        const slot = player.items.find(s=>s.id===it.id);
        if (slot) slot.qty++; else player.items.push({ id:it.id, name:it.name, heal:it.heal, qty:1 });
        appendCombatLog(`Picked up: ${it.name}`);
        fieldItems.splice(i,1); return;
      }
    }
  });

  // rendering
  function drawBackground() {
    const g = ctx.createLinearGradient(0,0,0,canvas.height);
    g.addColorStop(0,'#07071a'); g.addColorStop(1,'#0b0b12'); ctx.fillStyle=g; ctx.fillRect(0,0,canvas.width,canvas.height);
  }
  function drawScene(time) {
    const dt = (time-lastTime)/1000; lastTime=time;
    drawBackground();
    // show different scenes
    if (state === 'battle' || state === 'battleStart' || state === 'victory') {
      // enemy
      ctx.fillStyle='#fff'; ctx.font='48px serif'; ctx.fillText('👻', canvas.width/2-24, 110);
      // bullets
      for (let idx=bullets.length-1; idx>=0; idx--) {
        const b = bullets[idx];
        b.x += b.vx; b.y += b.vy;
        const dx = b.x - soul.x; const dy = b.y - soul.y; const d = Math.sqrt(dx*dx+dy*dy);
        if (battlePhase==='attackpattern' && d < b.r + soul.size) {
          // mark as hit for fight minigame
          b._hit = true;
          // if we're in a fight minigame (not enemy attackActive) then keep and let fightTick count it; otherwise, let startEnemyAttack handle damage
          if (!attackActive) {
            // remove visual bullet to avoid repeated collision
            bullets.splice(idx,1);
            continue;
          }
        }
        if (b.y>canvas.height+120||b.x<-120||b.x>canvas.width+120) {
          bullets.splice(idx,1); continue;
        }
        ctx.beginPath(); ctx.fillStyle=b._hit? '#ffff88' : b.color; ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
      }
      // soul
      ctx.save(); ctx.translate(soul.x,soul.y); ctx.fillStyle='#ff6699'; drawHeart(ctx,0,0,soul.size); ctx.restore();
      // field items
      fieldItems.forEach(it=>{ ctx.beginPath(); ctx.fillStyle='#ffd27f'; ctx.arc(it.x,it.y,it.r,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#000'; ctx.font='12px monospace'; ctx.fillText(it.name, it.x-10, it.y+4); });
      // HUD hints
      ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.font='14px monospace'; ctx.fillText(`HP: ${player.hp}/${player.maxHp}`, 12, 24);
    } else {
      ctx.fillStyle='#fff'; ctx.font='20px "Press Start 2P", monospace'; if (state==='intro' || state==='exploration' || state==='battleStart' || state==='victory') ctx.fillText('— Story & Exploration —',20,40); else ctx.fillText('Press START to begin your adventure.',20,40);
    }
    if (bullets.length>0) { ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='14px monospace'; ctx.fillText(`Incoming: ${bullets.length}`,12,canvas.height-12); }
    requestAnimationFrame(drawScene);
  }
  function drawHeart(ctx,x,y,size){ const s=size; ctx.beginPath(); ctx.moveTo(x,y+s/4); ctx.bezierCurveTo(x,y-s/2,x-s,y-s/2,x-s,y+s/4); ctx.bezierCurveTo(x-s,y+s,x,y+s*1.4,x,y+s*1.8); ctx.bezierCurveTo(x,y+s*1.4,x+s,y+s,x+s,y+s/4); ctx.bezierCurveTo(x+s,y-s/2,x,y-s/2,x,y+s/4); ctx.fill(); }

  // soul movement
  window.addEventListener('keydown',(e)=>{ keys[e.key.toLowerCase()]=true; if (['arrowleft','arrowright','arrowup','arrowdown'].includes(e.key.toLowerCase())) e.preventDefault(); // quick save/load
    if (e.key.toLowerCase()==='p') { saveGame(); appendCombatLog('Game saved.'); }
    if (e.key.toLowerCase()==='o') { loadGame(); appendCombatLog('Game loaded.'); }
  });
  window.addEventListener('keyup',(e)=>{ keys[e.key.toLowerCase()]=false; });
  function updateSoulPosition(){ if (state==='battle' && battlePhase==='attackpattern') { if (keys['arrowleft']||keys['a']) soul.x-=soul.speed*2; if (keys['arrowright']||keys['d']) soul.x+=soul.speed*2; if (keys['arrowup']||keys['w']) soul.y-=soul.speed*2; if (keys['arrowdown']||keys['s']) soul.y+=soul.speed*2; const left=60,right=canvas.width-60,top=canvas.height-220,bottom=canvas.height-60; soul.x=Math.max(left,Math.min(right,soul.x)); soul.y=Math.max(top,Math.min(bottom,soul.y)); } else { soul.x += (canvas.width/2 - soul.x)*0.08; soul.y += ((canvas.height-140) - soul.y)*0.08; } requestAnimationFrame(updateSoulPosition); }

  function startBattleLoop(){ soul.x=canvas.width/2; soul.y=canvas.height-140; battlePhase='menu'; bullets=[]; appendCombatLog(`Battle vs ${enemy.name} starts!`); updateEnemyBar(); updatePlayerBar(); // spawn an item sometimes
    if (Math.random() < 0.6) {
      const r = Math.random();
      let pick;
      if (r < 0.55) pick = { id:'snack', name:'Snack', heal:20 };
      else if (r < 0.9) pick = { id:'bandage', name:'Bandage', heal:12 };
      else pick = { id:'shield', name:'Shield', heal:0 };
      spawnFieldItem(pick);
    }
  }

  function resetAll(){ player.hp=player.maxHp; player.exp=0; player.items=[{id:'snack',name:'Snack',heal:20,qty:2},{id:'shield',name:'Shield',heal:0,qty:0}]; encounters = JSON.parse(JSON.stringify(baseEncounters)); currentEncounterIndex=0; enemy=null; bullets=[]; if (combatLog) combatLog.innerHTML=''; currentDialogue=[]; dialogueIndex=0; killsCount=0; mercyCount=0; fieldItems=[]; setState('menu'); stopMusic(); }

  // Save / Load
  function saveGame(){
    try {
      // serialize only plain data; for encounters keep id/hp/flags
      const serialEnc = encounters.map(e => ({ id: e.id, hp: e.hp }));
      const data = {
        player: JSON.parse(JSON.stringify(player)),
        encounters: serialEnc,
        currentEncounterIndex, killsCount, mercyCount,
        state, fieldItems: JSON.parse(JSON.stringify(fieldItems)), currentBranch, rebellion
      };
      localStorage.setItem('grim_save_v1', JSON.stringify(data));
      appendCombatLog('Game saved.');
      if (saveIndicator) { saveIndicator.style.display='inline-block'; setTimeout(()=>{ saveIndicator.style.display='none'; }, 1600); }
    } catch (e) { console.warn('Save failed', e); appendCombatLog('Save failed.'); }
  }
  function loadGame(){
    try {
      const raw = localStorage.getItem('grim_save_v1');
      if (!raw) { appendCombatLog('No save found.'); return; }
      const data = JSON.parse(raw);
      // restore player
      Object.assign(player, JSON.parse(JSON.stringify(data.player)));
      // reconstruct encounters by id
      if (Array.isArray(data.encounters)) {
        encounters = data.encounters.map(se => {
          const be = findBaseEncounter(se.id);
          if (!be) return null;
          const copy = JSON.parse(JSON.stringify(be));
          if (typeof se.hp === 'number') copy.hp = se.hp;
          return copy;
        }).filter(Boolean);
      }
      currentEncounterIndex = data.currentEncounterIndex || 0;
      killsCount = data.killsCount || 0;
      mercyCount = data.mercyCount || 0;
      fieldItems = Array.isArray(data.fieldItems) ? JSON.parse(JSON.stringify(data.fieldItems)) : [];
  currentBranch = data.currentBranch || 'start';
  rebellion = data.rebellion || 0;
      updatePlayerBar(); if (enemy) updateEnemyBar();
      appendCombatLog('Loaded save.');
    } catch (e) { console.warn('Load failed', e); appendCombatLog('Load failed.'); }
  }


  // decide ending by route
  function decideEnding(){ // simple rules: genocide if kills >= full count, pacifist if kills===0 and mercyCount === totalEncounters, neutral otherwise
    const total = baseEncounters.length;
    if (killsCount >= total) { currentDialogue = story.endingGenocide.slice(); setState('ending'); dialogueIndex=0; }
    else if (killsCount === 0 && mercyCount >= total && rebellion < 2) { currentDialogue = story.endingPacifist.slice(); setState('ending'); dialogueIndex=0; }
    else { currentDialogue = story.endingNeutral.slice(); setState('ending'); dialogueIndex=0; }
  }

  // renderBattleMenu: small helper to ensure menus exist in DOM, otherwise just no-op
  function renderBattleMenu() {
    // show helpful battle info in menu-info
    if (menuInfo) {
      const hpPct = enemy ? Math.round((enemy.hp/enemy.maxHp)*100) : 0;
      menuInfo.textContent = enemy ? `${enemy.name} — HP: ${enemy.hp}/${enemy.maxHp} (${hpPct}%)` : 'Choose an action: FIGHT, ACT, ITEM or MERCY.';
    }
    if (actsList && actsList.innerHTML.trim()==='') actsList.innerHTML = '<div style="color:#666;font-size:12px">Press ACT to see your options.</div>';
    if (itemsList && itemsList.innerHTML.trim()==='') itemsList.innerHTML = '<div style="color:#666;font-size:12px">Press ITEM to see and use items.</div>';
    // keep menus ready; actual population happens in openActMenu/openItemMenu
  }

  // expose debug
  window._grimGame = { player, encounters, resetAll, saveGame, loadGame, startIntro };

  // init
  setState('menu'); lastTime = performance.now(); requestAnimationFrame(drawScene); requestAnimationFrame(updateSoulPosition);
  appendCombatLog('Small demo loaded. Press START to play. Press P to save, O to load.');
})();
