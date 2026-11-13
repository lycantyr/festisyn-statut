// Page de statut de Festisyn (13 novembre 2026). Sans étape de construction : ce fichier est servi tel quel par GitHub Pages.
// Sources, lues par le navigateur du visiteur :
// - les fichiers d'Upptime dans le dépôt (raw.githubusercontent.com) : état de chaque élément, jours d'incident, temps de
//   réponse vu de GitHub. Ils restent lisibles quand festisyn.com ne répond plus ;
// - les incidents (tickets GitHub ouverts par Upptime) par l'API de GitHub, limitée à 60 lectures par heure et par adresse :
//   gardés 5 minutes dans le navigateur, et la page fait sans eux quand GitHub refuse ;
// - https://festisyn.com/api/etat : les mesures du serveur (niveaux d'affluence, durées en secondes, ralentissements). Absentes
//   pendant une panne du site, ce que la page dit.
// Tout texte venu d'ailleurs est posé par textContent : rien n'est interprété comme du HTML.
"use strict";

(() => {
  const REPO = "lycantyr/festisyn-statut";
  const RAW = `https://raw.githubusercontent.com/${REPO}/master`;
  const API_INCIDENTS = `https://api.github.com/repos/${REPO}/issues?labels=status&state=all&per_page=100&sort=created&direction=desc`;
  const PAGE_INCIDENTS = `https://github.com/${REPO}/issues?q=label%3Astatus`;
  const ETAT = "https://festisyn.com/api/etat";
  const ELEMENTS = [
    { slug: "festisyn-com", cle: "site", nom: "Site et pages", aide: "Les pages de festisyn.com s’ouvrent et lisent leurs données." },
    { slug: "carte-et-recherche", cle: "carte", nom: "Carte et recherche", aide: "La carte trouve les sorties autour de toi, et la recherche répond." },
    { slug: "connexion-et-comptes", cle: "comptes", nom: "Connexion et comptes", aide: "Tu peux te connecter et retrouver ton compte." },
    { slug: "mise-a-jour-de-nuit", cle: "nuit", nom: "Mise à jour de nuit", aide: "Chaque nuit vers 4 h, les nouvelles sorties arrivent sur la carte." },
  ];
  const NB = " ";
  // Espace insécable avant « : ; ! ? » et après « « » (typographie française), pour tout texte posé dans la page.
  const typo = (texte) => String(texte).replace(/ ([:;!?»])/g, `${NB}$1`).replace(/« /g, `«${NB}`);
  const MINUTE = 60_000;
  const HEURE = 3_600_000;
  const JOUR = 86_400_000;
  const RAFRAICHIR_MS = 60_000;
  const INCIDENTS_FRAIS_MS = 5 * MINUTE;
  const CLE_CACHE = "festisyn-statut-incidents-1";

  // ---------- Dates, à l'heure de Paris ----------
  const format = (options) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", ...options });
  const F_HM = format({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const F_JOUR = format({ weekday: "long", day: "numeric", month: "long" });
  const F_DATE = format({ day: "numeric", month: "long" });
  const F_COURT = format({ weekday: "short", day: "numeric" });
  const F_COURT_MOIS = format({ weekday: "short", day: "numeric", month: "short" });
  const F_CLE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" });
  const F_HEURE_SEULE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" });
  const cleJour = (ms) => F_CLE.format(new Date(ms));
  const heureParis = (ms) => Number(F_HEURE_SEULE.format(new Date(ms))) % 24;
  const majuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);
  function heure(ms) {
    const [h, m] = F_HM.format(new Date(ms)).split(":");
    return `${Number(h)}${NB}h${m === "00" ? "" : `${NB}${m}`}`;
  }
  const jour = (ms) => F_JOUR.format(new Date(ms));
  // Début (00:00 à Paris) du jour de clé « AAAA-MM-JJ ».
  function debutJour(cle) {
    const [a, m, j] = cle.split("-").map(Number);
    const minuitUtc = Date.UTC(a, m - 1, j);
    for (const decalage of [1, 2, 0]) {
      const t = minuitUtc - decalage * HEURE;
      if (cleJour(t) === cle && cleJour(t - 1) !== cle) return t;
    }
    return minuitUtc - HEURE;
  }
  // Les n derniers jours, le plus ancien d'abord, aujourd'hui en dernier.
  function derniersJours(n, maintenant) {
    const midi = debutJour(cleJour(maintenant)) + 12 * HEURE;
    const cles = [];
    for (let i = n - 1; i >= 0; i--) cles.push(cleJour(midi - i * JOUR));
    return cles.map((cle) => ({ cle, debut: debutJour(cle), fin: debutJour(cleJour(debutJour(cle) + 36 * HEURE)) }));
  }
  function duree(ms) {
    const minutes = Math.max(1, Math.round(ms / MINUTE));
    if (minutes < 60) return `${minutes}${NB}min`;
    const h = Math.floor(minutes / 60);
    const reste = minutes % 60;
    return reste ? `${h}${NB}h${NB}${String(reste).padStart(2, "0")}` : `${h}${NB}h`;
  }
  const secondes = (valeur) => `${valeur.toLocaleString("fr-FR", { minimumFractionDigits: valeur < 10 ? 2 : 1, maximumFractionDigits: valeur < 10 ? 2 : 1 })}${NB}s`;
  function pourcentage(valeur) {
    if (valeur >= 99.995) return `100${NB}%`;
    return `${(Math.floor(valeur * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${NB}%`;
  }
  const liste = (mots) => (mots.length < 2 ? mots.join("") : `${mots.slice(0, -1).join(", ")} et ${mots.at(-1)}`);

  // ---------- Petit outillage du DOM ----------
  function el(nom, attributs = {}, ...enfants) {
    const noeud = document.createElement(nom);
    for (const [cle, valeur] of Object.entries(attributs)) {
      if (valeur === null || valeur === undefined || valeur === false) continue;
      if (cle === "texte") noeud.textContent = typo(valeur);
      else if (cle === "classe") noeud.className = valeur;
      // Variables CSS posées par le CSSOM : la politique de contenu de la page refuse l'attribut style.
      else if (cle === "vars") for (const [nom, v] of Object.entries(valeur)) noeud.style.setProperty(nom, String(v));
      else noeud.setAttribute(cle, valeur === true ? "" : valeur);
    }
    for (const enfant of enfants.flat()) if (enfant !== null && enfant !== undefined && enfant !== false) noeud.append(typeof enfant === "string" ? typo(enfant) : enfant);
    return noeud;
  }
  const SVG = "http://www.w3.org/2000/svg";
  function svg(nom, attributs = {}, ...enfants) {
    const noeud = document.createElementNS(SVG, nom);
    for (const [cle, valeur] of Object.entries(attributs)) if (valeur !== null && valeur !== undefined) noeud.setAttribute(cle, valeur);
    for (const enfant of enfants.flat()) if (enfant) noeud.append(enfant);
    return noeud;
  }
  // Icônes dessinées (trait de 2), une forme par état : cercle coché, triangle, octogone barré, cercle en pointillés.
  const TRACES = {
    ok: ['<circle cx="12" cy="12" r="9"/>', '<path d="M8 12.4l2.7 2.7L16.2 9.6"/>'],
    lent: ['<path d="M12 3.6 21.2 19.6H2.8Z"/>', '<path d="M12 9.8v4.4M12 17.1v.1"/>'],
    panne: ['<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3Z"/>', '<path d="M9.4 9.4l5.2 5.2M14.6 9.4l-5.2 5.2"/>'],
    inconnu: ['<circle cx="12" cy="12" r="9" stroke-dasharray="2.6 3.2"/>', '<path d="M8.5 12h7"/>'],
  };
  const GLYPHES = {
    ok: '<path d="M6.5 12.6l3.6 3.6L17.6 8.6"/>',
    lent: '<path d="M12 6.5v7M12 17.3v.2"/>',
    panne: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
    "panne-partielle": '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
    inconnu: '<path d="M7 12h10"/>',
    chargement: '<path d="M7 12h10"/>',
  };
  function icone(etatIcone, glyphe = false) {
    const noeud = document.createElementNS(SVG, "svg");
    noeud.setAttribute("viewBox", "0 0 24 24");
    noeud.setAttribute("fill", "none");
    noeud.setAttribute("stroke", "currentColor");
    noeud.setAttribute("stroke-width", glyphe ? "2.6" : "2");
    noeud.setAttribute("stroke-linecap", "round");
    noeud.setAttribute("stroke-linejoin", "round");
    noeud.setAttribute("aria-hidden", "true");
    noeud.setAttribute("focusable", "false");
    // Tracés écrits ici, jamais venus des données.
    noeud.innerHTML = glyphe ? GLYPHES[etatIcone] ?? GLYPHES.inconnu : (TRACES[etatIcone] ?? TRACES.inconnu).join("");
    return noeud;
  }

  // ---------- Lectures ----------
  const donnees = { resume: null, resumeErreur: false, histoires: {}, incidents: null, incidentsInfo: {}, api: null, apiErreur: null, lu: null };

  async function lire(url, { delai = 10_000, entetes } = {}) {
    const arret = new AbortController();
    const minuterie = setTimeout(() => arret.abort(), delai);
    try {
      return await fetch(url, { signal: arret.signal, headers: entetes, credentials: "omit" });
    } finally {
      clearTimeout(minuterie);
    }
  }

  async function lireResume() {
    try {
      const reponse = await lire(`${RAW}/history/summary.json`);
      if (!reponse.ok) throw new Error(String(reponse.status));
      const liste = await reponse.json();
      donnees.resume = Object.fromEntries((Array.isArray(liste) ? liste : []).map((site) => [site.slug, site]));
      donnees.resumeErreur = false;
    } catch {
      donnees.resumeErreur = true;
    }
  }

  // history/<slug>.yml : début du suivi, dernier changement d'état.
  async function lireHistoire(slug) {
    try {
      const reponse = await lire(`${RAW}/history/${slug}.yml`);
      if (reponse.status === 404) {
        donnees.histoires[slug] = { absente: true };
        return;
      }
      if (!reponse.ok) throw new Error(String(reponse.status));
      const texte = await reponse.text();
      const champs = Object.fromEntries(
        texte
          .split("\n")
          .map((ligne) => ligne.match(/^(\w+):\s*(.*)$/))
          .filter(Boolean)
          .map((m) => [m[1], m[2].trim()]),
      );
      donnees.histoires[slug] = { debut: Date.parse(champs.startTime) || null, change: Date.parse(champs.lastUpdated) || null, statut: champs.status ?? null };
    } catch {
      if (!donnees.histoires[slug]) donnees.histoires[slug] = { erreur: true };
    }
  }

  function lireCache() {
    try {
      const valeur = JSON.parse(localStorage.getItem(CLE_CACHE) ?? "null");
      return valeur && typeof valeur === "object" ? valeur : null;
    } catch {
      return null;
    }
  }
  function ecrireCache(valeur) {
    try {
      localStorage.setItem(CLE_CACHE, JSON.stringify(valeur));
    } catch {
      // Stockage refusé (navigation privée) : la page relit GitHub la prochaine fois.
    }
  }
  const SLUGS = new Set(ELEMENTS.map((element) => element.slug));
  function incidentDe(ticket) {
    const noms = (ticket.labels ?? []).map((label) => (typeof label === "string" ? label : label?.name));
    const slug = noms.find((nom) => SLUGS.has(nom));
    const url = String(ticket.html_url ?? "");
    if (!slug || ticket.pull_request || !noms.includes("status") || !url.startsWith(`https://github.com/${REPO}/issues/`)) return null;
    const debut = Date.parse(ticket.created_at);
    if (!debut) return null;
    return { n: Number(ticket.number), url, slug, debut, fin: Date.parse(ticket.closed_at) || null, sorte: /degraded/i.test(String(ticket.title ?? "")) ? "lent" : "panne" };
  }
  async function lireIncidents() {
    const cache = lireCache();
    const maintenant = Date.now();
    if (cache?.incidents && maintenant - cache.lu < INCIDENTS_FRAIS_MS) {
      donnees.incidents = cache.incidents;
      donnees.incidentsInfo = { lu: cache.lu };
      return;
    }
    if (cache?.limiteJusqua && maintenant < cache.limiteJusqua) {
      donnees.incidents = cache.incidents ?? null;
      donnees.incidentsInfo = { limite: true, jusqua: cache.limiteJusqua, lu: cache.lu ?? null };
      return;
    }
    try {
      const reponse = await lire(API_INCIDENTS, { entetes: { Accept: "application/vnd.github+json" } });
      const reste = Number(reponse.headers.get("x-ratelimit-remaining"));
      const remise = Number(reponse.headers.get("x-ratelimit-reset")) * 1000 || maintenant + HEURE;
      if (reponse.status === 403 || reponse.status === 429) {
        ecrireCache({ incidents: cache?.incidents ?? null, lu: cache?.lu ?? null, limiteJusqua: remise });
        donnees.incidents = cache?.incidents ?? null;
        donnees.incidentsInfo = { limite: true, jusqua: remise, lu: cache?.lu ?? null };
        return;
      }
      if (!reponse.ok) throw new Error(String(reponse.status));
      const tickets = await reponse.json();
      const incidents = (Array.isArray(tickets) ? tickets : []).map(incidentDe).filter(Boolean);
      // Presque plus de lectures permises : la suivante attend la remise à zéro de GitHub.
      ecrireCache({ incidents, lu: maintenant, limiteJusqua: Number.isFinite(reste) && reste < 3 ? remise : null });
      donnees.incidents = incidents;
      donnees.incidentsInfo = { lu: maintenant };
    } catch {
      donnees.incidents = cache?.incidents ?? null;
      donnees.incidentsInfo = { erreur: true, lu: cache?.lu ?? null };
    }
  }

  async function lireApi() {
    try {
      const reponse = await lire(ETAT, { delai: 12_000 });
      if (reponse.status === 404) {
        donnees.api = null;
        donnees.apiErreur = "absente";
        return;
      }
      if (!reponse.ok) {
        donnees.api = null;
        donnees.apiErreur = "erreur";
        return;
      }
      donnees.api = await reponse.json();
      donnees.apiErreur = null;
    } catch {
      // Réseau, délai, ou page d'erreur de Cloudflare sans l'autorisation de lecture : le site ne répond pas à cette page.
      donnees.api = null;
      donnees.apiErreur = "injoignable";
    }
  }

  async function toutLire(incidentsAussi) {
    await Promise.all([lireResume(), lireApi(), ...ELEMENTS.map((element) => lireHistoire(element.slug)), incidentsAussi ? lireIncidents() : null]);
    donnees.lu = Date.now();
  }

  // ---------- Interprétation ----------
  // La mise à jour de nuit tourne à part (service d'import) : pendant une panne du site, son point de contrôle, sur le site,
  // ne répond pas non plus, sans que rien dise qu'elle a échoué. Ses incidents pendant une panne du site sont « non vérifiables ».
  function couvertParSite(incident, maintenant = Date.now()) {
    if (incident.slug !== "mise-a-jour-de-nuit" || !donnees.incidents) return false;
    const fin = incident.fin ?? maintenant;
    return donnees.incidents.some((autre) => autre.slug === "festisyn-com" && autre.sorte === "panne" && autre.debut <= fin && (autre.fin ?? maintenant) >= incident.debut - 10 * MINUTE);
  }
  // Jours d'un élément : « ok », « lent », « panne », « incident » (détail indisponible), « non-suivi ».
  function joursDe(element, jours, maintenant) {
    const histoire = donnees.histoires[element.slug] ?? {};
    const resume = donnees.resume?.[element.slug];
    const debutSuivi = histoire.debut ?? null;
    const suivi = Boolean(resume) || Boolean(debutSuivi);
    const incidents = donnees.incidents?.filter((incident) => incident.slug === element.slug && !couvertParSite(incident, maintenant)) ?? null;
    return jours.map((j) => {
      const fin = Math.min(j.fin, maintenant);
      if (!suivi || (debutSuivi && j.fin <= debutSuivi) || fin <= j.debut) return { ...j, etat: "non-suivi" };
      if (incidents) {
        const parSorte = { panne: [], lent: [] };
        for (const incident of incidents) {
          const a = Math.max(incident.debut, j.debut);
          const b = Math.min(incident.fin ?? maintenant, fin);
          if (b > a) parSorte[incident.sorte].push([a, b, incident]);
        }
        const total = (morceaux) => fusion(morceaux).reduce((somme, [a, b]) => somme + (b - a), 0);
        const panne = total(parSorte.panne);
        const lent = total(parSorte.lent);
        const tous = [...parSorte.panne, ...parSorte.lent];
        if (panne > 0) return { ...j, etat: "panne", ms: panne, morceaux: tous };
        if (lent > 0) return { ...j, etat: "lent", ms: lent, morceaux: tous };
        return { ...j, etat: "ok" };
      }
      const minutes = Number(resume?.dailyMinutesDown?.[j.cle] ?? 0);
      return minutes > 0 ? { ...j, etat: "incident", ms: minutes * MINUTE } : { ...j, etat: "ok" };
    });
  }
  function fusion(morceaux) {
    const tries = morceaux.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
    const sortie = [];
    for (const [a, b] of tries) {
      const dernier = sortie.at(-1);
      if (dernier && a <= dernier[1]) dernier[1] = Math.max(dernier[1], b);
      else sortie.push([a, b]);
    }
    return sortie;
  }
  // Disponibilité sur les n derniers jours : temps en panne rapporté au temps suivi.
  function disponibilite(jours, maintenant) {
    let suivi = 0;
    let panne = 0;
    for (const j of jours) {
      if (j.etat === "non-suivi") continue;
      suivi += Math.min(j.fin, maintenant) - j.debut;
      if (j.etat === "panne" || j.etat === "incident") panne += j.ms ?? 0;
    }
    return suivi > 0 ? (100 * (suivi - Math.min(panne, suivi))) / suivi : null;
  }

  const RAISONS = {
    site: { "lecture-impossible": "Les pages ne lisent plus leurs données." },
    carte: { "lecture-impossible": "La carte ne trouve plus les sorties.", "reponse-inattendue": "La carte répond de travers." },
    comptes: { "reglages-manquants": "Un réglage de la connexion manque : on ne peut plus se connecter.", "lecture-impossible": "Les comptes ne se lisent plus : on ne peut plus se connecter." },
    nuit: {
      "etape-en-echec": "Une étape de la mise à jour de cette nuit a échoué : des sorties récentes peuvent manquer sur la carte.",
      "trop-ancien": "La mise à jour de nuit n’a pas tourné : les sorties ajoutées depuis n’apparaissent pas encore.",
      interrompu: "La mise à jour de nuit s’est arrêtée en route : des sorties récentes peuvent manquer.",
      "aucun-passage": "Aucune mise à jour de nuit récente.",
    },
  };
  const LENTEURS = {
    site: "Les pages de festisyn.com mettent plus de 5 secondes à répondre.",
    carte: "La carte et la recherche mettent plus de 5 secondes à répondre.",
    comptes: "La connexion met plus de 5 secondes à répondre.",
    nuit: "Le contrôle de la mise à jour de nuit met plus de 5 secondes à répondre.",
  };
  const SANS_RAISON = {
    site: "Les pages de festisyn.com ne répondent plus.",
    carte: "La carte ou la recherche ne répond plus.",
    comptes: "La connexion ne répond plus.",
    nuit: "La mise à jour de nuit est en échec.",
  };

  function etatDe(element, maintenant, siteEnPanne = false) {
    const resume = donnees.resume?.[element.slug];
    const histoire = donnees.histoires[element.slug] ?? {};
    const api = donnees.api?.elements?.[element.cle] ?? null;
    const statut = resume?.status ?? histoire.statut ?? null;
    const suivi = Boolean(resume) || Boolean(histoire.debut);
    const ouvert = donnees.incidents?.find((incident) => incident.slug === element.slug && !incident.fin) ?? null;
    let etat;
    if (statut === "down" || api?.etat === "panne") etat = "panne";
    else if (statut === "degraded") etat = "lent";
    else if (statut === "up" || api?.etat === "ok") etat = "ok";
    else etat = suivi || donnees.resumeErreur ? "inconnu" : "non-suivi";
    const nonVerifiable = element.cle === "nuit" && siteEnPanne && etat === "panne" && api?.etat !== "panne";
    if (nonVerifiable) etat = "inconnu";
    const depuis = ouvert?.debut ?? (etat !== "ok" && statut && statut !== "up" ? histoire.change : null);
    let detail = null;
    if (nonVerifiable) detail = "Impossible à vérifier tant que le site ne répond pas ; elle tourne à part, chaque nuit vers 4 h.";
    else if (etat === "panne" && siteEnPanne && element.cle !== "site") detail = "Indisponible tant que le site ne répond pas.";
    else if (etat === "panne") detail = (api?.raison && RAISONS[element.cle][api.raison]) || SANS_RAISON[element.cle];
    else if (etat === "lent") detail = LENTEURS[element.cle];
    else if (etat === "inconnu") detail = "État impossible à lire pour l’instant : GitHub ne répond pas à cette page.";
    if (element.cle === "nuit" && api?.fin && etat === "ok") detail = `Dernière mise à jour finie ${jour(Date.parse(api.fin))} à ${heure(Date.parse(api.fin))}${api.enCours ? " ; celle de cette nuit est en cours" : ""}.`;
    if (depuis && etat !== "ok" && etat !== "inconnu" && detail && !(siteEnPanne && element.cle !== "site")) {
      const quand = cleJour(depuis) === cleJour(maintenant) ? heure(depuis) : `le ${F_DATE.format(new Date(depuis))} à ${heure(depuis)}`;
      // « … ne répondent plus depuis 19 h 05. » ; après deux-points, une phrase à part.
      detail = detail.includes(":") ? `${detail} Depuis ${quand}.` : `${detail.replace(/\.$/, "")} depuis ${quand}.`;
    }
    return { etat, detail, ouvert, suivi };
  }

  const MOTS_ETAT = { ok: "Fonctionne", lent: "Ralenti", panne: "En panne", inconnu: "État inconnu", "non-suivi": "Pas encore suivi" };

  function bandeau(etats, maintenant) {
    const api = donnees.api;
    const rien = donnees.resumeErreur && !api;
    const site = etats[0];
    const pannes = ELEMENTS.filter((_, i) => etats[i].etat === "panne");
    const lents = ELEMENTS.filter((_, i) => etats[i].etat === "lent");
    const ouvert = etats.find((e) => e.ouvert)?.ouvert ?? null;
    const lienIncident = ouvert ? { texte: `Suivre l’incident n°${NB}${ouvert.n} sur GitHub`, url: ouvert.url } : null;
    if (rien) {
      return {
        etat: "inconnu",
        titre: "État impossible à lire",
        detail: donnees.apiErreur === "injoignable" ? "Ni GitHub ni festisyn.com ne répondent à cette page. Vérifie ta connexion à Internet ; la page réessaie toute seule chaque minute." : "GitHub ne répond pas à cette page ; elle réessaie toute seule chaque minute.",
      };
    }
    if (site.etat === "panne") {
      return { etat: "panne", titre: "Festisyn est en panne", detail: `${site.detail} L’équipe est prévenue, et cette page se met à jour toute seule.`, lien: lienIncident };
    }
    if (pannes.length) {
      const phrases = pannes.map((element) => etats[ELEMENTS.indexOf(element)].detail).join(" ");
      return { etat: "panne-partielle", titre: `Panne : ${pannes.map((e) => e.nom).join(", ")}`, detail: `${phrases} Le reste du site fonctionne.`, lien: lienIncident };
    }
    if (donnees.apiErreur && donnees.apiErreur !== "absente" && !donnees.resumeErreur) {
      const dernier = donnees.histoires["festisyn-com"]?.change;
      return {
        etat: "lent",
        titre: "Le site ne répond pas à cette page",
        detail: `GitHub le trouvait en ligne au dernier test${dernier ? ` (état inchangé depuis ${heure(dernier)})` : ""}. Si festisyn.com ne s’ouvre pas chez toi non plus, le prochain test, dans 5 minutes au plus, ouvrira un incident.`,
      };
    }
    if (lents.length || api?.maintenant?.ralenti) {
      const phrases = [];
      if (api?.maintenant?.refus) phrases.push("Le site est très demandé : certaines pages répondent « réessaie dans quelques secondes ».");
      else if (api?.maintenant?.ralenti && api.maintenant.p95 !== null) phrases.push(`Les pages mettent plus de temps que d’habitude à s’ouvrir : 1 sur 20 prend plus de ${secondes(api.maintenant.p95)}.`);
      for (const element of lents) phrases.push(LENTEURS[element.cle]);
      return { etat: "lent", titre: "Festisyn est ralenti", detail: `${phrases.join(" ")} Tout finit par s’afficher : patiente un peu, ou réessaie.`, lien: lienIncident };
    }
    if (etats.every((e) => e.etat === "ok")) {
      return { etat: "ok", titre: "Tout fonctionne", detail: "Le site, la carte, la connexion et la mise à jour de nuit répondent normalement." };
    }
    const connus = etats.filter((e) => e.etat === "ok").length;
    return { etat: "ok", titre: "Tout fonctionne", detail: `Ce qui est suivi répond normalement (${connus} élément${connus > 1 ? "s" : ""} sur 4).` };
  }

  // ---------- Lecture au clavier et au doigt (un arrêt de tabulation par graphique) ----------
  const actifs = new Map();
  function lecteur({ cadre, id, compter, montrer, sens = () => "ligne", etapes = () => ({}) }) {
    cadre.tabIndex = 0;
    cadre.dataset.lecteur = id;
    let actif = actifs.get(id) ?? null;
    const poser = (index) => {
      const total = compter();
      if (!total) return;
      actif = index === null ? null : Math.max(0, Math.min(total - 1, index));
      actifs.set(id, actif);
      montrer(actif);
    };
    cadre.addEventListener("keydown", (evenement) => {
      const total = compter();
      const courant = actif ?? total - 1;
      const pas = etapes();
      const ligne = sens() === "ligne";
      const mouvements = {
        ArrowLeft: courant - (ligne ? 1 : (pas.travers ?? 1)),
        ArrowRight: courant + (ligne ? 1 : (pas.travers ?? 1)),
        ArrowUp: courant - (ligne ? (pas.travers ?? 0) : 1),
        ArrowDown: courant + (ligne ? (pas.travers ?? 0) : 1),
        Home: 0,
        End: total - 1,
        PageUp: courant - (pas.page ?? 10),
        PageDown: courant + (pas.page ?? 10),
      };
      if (!(evenement.key in mouvements)) return;
      if ((evenement.key === "ArrowUp" || evenement.key === "ArrowDown") && ligne && !pas.travers) return;
      evenement.preventDefault();
      poser(mouvements[evenement.key]);
    });
    cadre.addEventListener("focus", () => poser(actif ?? compter() - 1));
    cadre.addEventListener("blur", () => poser(null));
    // Au doigt, la lecture reste après le toucher ; à la souris, elle s'efface quand le pointeur sort.
    cadre.addEventListener("pointerleave", (evenement) => {
      if (evenement.pointerType === "mouse" && document.activeElement !== cadre) poser(null);
    });
    if (actif !== null) montrer(actif);
    return poser;
  }

  // ---------- Éléments du service ----------
  function rendreElements(maintenant) {
    const jours = derniersJours(90, maintenant);
    const site = etatDe(ELEMENTS[0], maintenant);
    const etats = ELEMENTS.map((element, rang) => (rang === 0 ? site : etatDe(element, maintenant, site.etat === "panne")));
    const liste = document.getElementById("liste-elements");
    const lignes = ELEMENTS.map((element, rang) => {
      const etat = etats[rang];
      const parJour = joursDe(element, jours, maintenant);
      const dispo = [30, 60, 90].map((n) => disponibilite(parJour.slice(-n), maintenant));
      const debutSuivi = donnees.histoires[element.slug]?.debut ?? null;
      const barres = el("div", { classe: "barres", "aria-hidden": "true" }, parJour.map((j) => el("span", { classe: "barre", "data-jour": j.etat })));
      const periode = (n, ...contenu) => el("span", { classe: `periode-${n}` }, ...contenu);
      // Disponibilité de la période montrée (30, 60 ou 90 jours selon la largeur, comme les barres).
      const depuisSuivi = debutSuivi ? (cleJour(debutSuivi) === cleJour(maintenant) ? `aujourd’hui à ${heure(debutSuivi)}` : `le ${F_DATE.format(new Date(debutSuivi))}`) : null;
      const ligneDispo = el(
        "p",
        { classe: "element-dispo" },
        ...[30, 60, 90].map((n, i) => {
          if (dispo[i] === null) return periode(n, etat.suivi ? `Pas encore de mesure sur les ${n} derniers jours.` : "Pas encore testé par GitHub : ses barres se remplissent à partir du premier test.");
          const recent = debutSuivi && debutSuivi > jours.at(-n).debut;
          return periode(n, el("strong", {}, pourcentage(dispo[i])), recent ? ` du temps en ligne depuis le début du suivi, ${depuisSuivi}.` : ` du temps en ligne sur les ${n} derniers jours.`);
        }),
      );
      const repos = () => [el("span", {}, periode(30, "Il y a 30 jours"), periode(60, "Il y a 60 jours"), periode(90, "Il y a 90 jours")), el("span", {}, "Aujourd’hui")];
      const lectureJours = el("p", { classe: "jours-lecture", "aria-live": "polite" }, repos());
      const cadre = el("div", { classe: "jours", role: "group", "aria-label": `${element.nom}, jour par jour : flèches gauche et droite pour lire chaque jour` }, barres, lectureJours);
      const visibles = () => [...barres.children].filter((barre) => getComputedStyle(barre).display !== "none");
      const decrire = (j) => {
        const etroit = cadre.clientWidth < 480;
        const quand = cleJour(j.debut) === cleJour(maintenant) ? "Aujourd’hui" : majuscule(etroit ? F_COURT_MOIS.format(new Date(j.debut)) : jour(j.debut));
        if (j.etat === "non-suivi") return `${quand} : pas encore suivi.`;
        if (j.etat === "ok") return `${quand} : sans incident.`;
        if (j.etat === "incident") return `${quand} : incident de ${duree(j.ms)} (détail indisponible).`;
        const plages = fusion(j.morceaux ?? []).map(([a, b]) => `de ${heure(a)} à ${b >= maintenant - MINUTE ? "maintenant" : heure(b)}`);
        const vues = etroit ? [] : plages.length > 2 ? [...plages.slice(0, 2), "…"] : plages;
        return `${quand} : ${j.etat === "panne" ? "panne" : "ralentissement"} de ${duree(j.ms)}${vues.length ? ` (${vues.join(", ")})` : ""}.`;
      };
      const montrer = (index) => {
        const tous = visibles();
        for (const barre of barres.children) barre.removeAttribute("data-actif");
        if (index === null) {
          lectureJours.removeAttribute("data-actif");
          lectureJours.replaceChildren(...repos());
          return;
        }
        const barre = tous[index];
        if (!barre) return;
        barre.setAttribute("data-actif", "");
        lectureJours.setAttribute("data-actif", "");
        lectureJours.textContent = typo(decrire(parJour[[...barres.children].indexOf(barre)]));
      };
      const poser = lecteur({ cadre, id: `jours-${element.slug}`, compter: () => visibles().length, montrer, etapes: () => ({ page: 7 }) });
      const pointer = (evenement) => {
        const tous = visibles();
        const boite = barres.getBoundingClientRect();
        if (!tous.length || boite.width <= 0) return;
        poser(Math.floor(((evenement.clientX - boite.left) / boite.width) * tous.length));
      };
      cadre.addEventListener("pointermove", pointer);
      cadre.addEventListener("pointerdown", pointer);

      const lignesTableau = parJour
        .filter((j) => j.etat !== "non-suivi")
        .reverse()
        .map((j) => el("tr", {}, el("th", { scope: "row" }, majuscule(jour(j.debut))), el("td", {}, { ok: "Sans incident", lent: "Ralentissement", panne: "Panne", incident: "Incident" }[j.etat]), el("td", {}, j.ms ? duree(j.ms) : "—")));
      const tableau = lignesTableau.length
        ? el(
            "details",
            {},
            el("summary", {}, "Voir les jours en tableau"),
            el("div", { classe: "tableau-cadre" }, el("table", { "aria-label": `${element.nom}, jour par jour` }, el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Jour"), el("th", { scope: "col" }, "État"), el("th", { scope: "col" }, "Durée"))), el("tbody", {}, lignesTableau))),
            debutSuivi ? el("p", { classe: "bloc-aide" }, `Suivi depuis le ${F_DATE.format(new Date(debutSuivi))}.`) : null,
          )
        : null;

      return el(
        "li",
        { classe: "element" },
        el(
          "div",
          { classe: "element-tete" },
          el("h3", { classe: "element-nom" }, element.nom),
          el("span", { classe: "element-etat", "data-etat": etat.etat }, icone(etat.etat === "non-suivi" ? "inconnu" : etat.etat), MOTS_ETAT[etat.etat]),
        ),
        el("p", { classe: "element-aide" }, element.aide),
        etat.detail ? el("p", { classe: "element-detail" }, etat.detail) : null,
        ligneDispo,
        cadre,
        tableau,
      );
    });
    liste.replaceChildren(...lignes);
    // Jours d'incident sans détail (incidents illisibles) : leur légende.
    document.getElementById("legende-incident").hidden = !liste.querySelector('.barre[data-jour="incident"]');
    return etats;
  }

  // ---------- Bandeau ----------
  function rendreBandeau(etats, maintenant) {
    const b = bandeau(etats, maintenant);
    const section = document.getElementById("bandeau");
    if (section.dataset.etat !== b.etat) section.dataset.etat = b.etat;
    section.querySelector(".bandeau-icone").replaceChildren(icone(b.etat, true));
    const titre = document.getElementById("bandeau-titre");
    const detail = document.getElementById("bandeau-detail");
    if (titre.textContent !== typo(b.titre)) titre.textContent = typo(b.titre);
    if (detail.textContent !== typo(b.detail)) detail.textContent = typo(b.detail);
    const lien = document.getElementById("bandeau-lien");
    if (b.lien) {
      lien.hidden = false;
      lien.replaceChildren(el("a", { href: b.lien.url }, b.lien.texte));
    } else {
      lien.hidden = true;
      lien.replaceChildren();
    }
    document.title = b.etat === "ok" ? "État de Festisyn" : typo(`${b.titre} · État de Festisyn`);
    // Le site ne répond pas : le bouton de l'en-tête propose de réessayer, en contour plutôt qu'en plein.
    const indisponible = etats[0].etat === "panne" || (donnees.apiErreur && donnees.apiErreur !== "absente" && !donnees.resumeErreur);
    const bouton = document.querySelector(".vers-site");
    bouton.toggleAttribute("data-indisponible", Boolean(indisponible));
    bouton.querySelector(".vers-site-debut").textContent = indisponible ? "Réessayer " : "Aller sur ";
  }

  // ---------- Temps de réponse ----------
  const NIVEAUX = { calme: "calme", habituelle: "habituelle", forte: "forte", "tres-forte": "très forte" };
  function phraseTemps() {
    const api = donnees.api;
    const site = donnees.resume?.["festisyn-com"];
    const exterieur = site && site.status !== "down" && Number.isFinite(site.timeDay) && site.timeDay > 0 ? ` Vu de l’extérieur, depuis GitHub, festisyn.com répond en ${secondes(site.timeDay / 1000)} en moyenne sur 24 heures.` : "";
    if (!api) {
      return donnees.apiErreur === "absente"
        ? `Les mesures du serveur ne sont pas encore publiées.${exterieur}`
        : `Les mesures du serveur sont indisponibles : festisyn.com ne répond pas à cette page. Elles reviennent avec lui.${exterieur}`;
    }
    const m = api.maintenant;
    if (!m || m.p95 === null) return `Pas encore de mesure ces 15 dernières minutes.${exterieur}`;
    return `En ce moment, 19 pages sur 20 se préparent en moins de ${secondes(m.p95)}${m.ralenti ? " : c’est plus lent que d’habitude" : ""}.${exterieur}`;
  }

  function rendreTemps(maintenant) {
    document.getElementById("temps-phrase").textContent = typo(phraseTemps());
    const zone = document.getElementById("graphique-temps");
    const heures = donnees.api?.heures ?? null;
    const seuil = donnees.api?.seuils?.ralentiSecondes ?? 2;
    if (!heures || !heures.some((h) => h.p95 !== null)) {
      zone.replaceChildren(el("div", { classe: "panneau vide" }, heures ? "Les mesures heure par heure commencent : le graphique se remplit au fil des heures." : "Le graphique des 7 derniers jours revient quand festisyn.com répond."));
      return;
    }
    const largeur = Math.max(260, zone.clientWidth - 42);
    const hauteur = largeur < 480 ? 170 : 210;
    const marge = { gauche: 34, droite: 6, haut: 10, bas: 26 };
    const l = largeur - marge.gauche - marge.droite;
    const h = hauteur - marge.haut - marge.bas;
    const max = Math.max(seuil * 1.25, ...heures.map((x) => x.p95 ?? 0)) * 1.08;
    const pas = [0.5, 1, 2, 5, 10, 20].find((p) => max / p <= 5) ?? 50;
    const haut = Math.ceil(max / pas) * pas;
    const x = (i) => marge.gauche + ((i + 0.5) * l) / heures.length;
    const y = (v) => marge.haut + h - (v / haut) * h;
    const colonne = l / heures.length;
    const traces = [];
    for (let v = 0; v <= haut + 1e-9; v += pas) {
      traces.push(svg("line", { class: "grille", x1: marge.gauche, x2: largeur - marge.droite, y1: y(v), y2: y(v) }));
      traces.push(svg("text", { x: marge.gauche - 6, y: y(v) + 4, "text-anchor": "end" }, document.createTextNode(`${v.toLocaleString("fr-FR")}${NB}s`)));
    }
    heures.forEach((heureMesuree, i) => {
      if (heureMesuree.ralenti) traces.push(svg("rect", { class: "heure-lente", x: x(i) - colonne / 2, y: marge.haut, width: Math.max(1, colonne), height: h }));
    });
    // Minuits de Paris : un trait et le nom du jour.
    heures.forEach((heureMesuree, i) => {
      const debut = Date.parse(heureMesuree.debut);
      if (heureParis(debut) !== 0) return;
      traces.push(svg("line", { class: "grille", x1: x(i) - colonne / 2, x2: x(i) - colonne / 2, y1: marge.haut, y2: marge.haut + h + 4 }));
      const milieu = Math.min(x(i) - colonne / 2 + 12 * colonne, largeur - marge.droite - 14);
      if (milieu < largeur - marge.droite - 10) {
        traces.push(svg("text", { x: milieu, y: hauteur - 6, "text-anchor": "middle" }, document.createTextNode(largeur < 420 ? F_COURT.format(new Date(debut)).split(" ").at(-1) : F_COURT.format(new Date(debut)))));
      }
    });
    traces.push(svg("line", { class: "seuil", x1: marge.gauche, x2: largeur - marge.droite, y1: y(seuil), y2: y(seuil) }));
    const chemin = (cle) => {
      let d = "";
      let leve = true;
      heures.forEach((heureMesuree, i) => {
        const v = heureMesuree[cle];
        if (v === null || v === undefined) {
          leve = true;
          return;
        }
        d += `${leve ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
        leve = false;
      });
      return d;
    };
    traces.push(svg("path", { class: "p50", d: chemin("p50") }));
    traces.push(svg("path", { class: "p95", d: chemin("p95") }));
    // Une heure mesurée seule (entre deux trous, ou la toute première) : un point, qu'un trait ne dessinerait pas.
    heures.forEach((heureMesuree, i) => {
      const seule = heureMesuree.p95 !== null && (heures[i - 1]?.p95 ?? null) === null && (heures[i + 1]?.p95 ?? null) === null;
      if (seule) traces.push(svg("circle", { class: "point-seul", cx: x(i), cy: y(heureMesuree.p95), r: 3 }));
    });
    const curseur = svg("line", { class: "curseur", x1: 0, x2: 0, y1: marge.haut, y2: marge.haut + h, visibility: "hidden" });
    const point = svg("circle", { class: "point", r: 4, cx: 0, cy: 0, visibility: "hidden" });
    traces.push(curseur, point);
    const dessin = svg("svg", { viewBox: `0 0 ${largeur} ${hauteur}`, width: largeur, height: hauteur, "aria-hidden": "true", focusable: "false" }, traces);
    const lecture = el("p", { classe: "lecture", "aria-live": "polite" }, "Passe le doigt, la souris ou les flèches du clavier sur le graphique pour lire chaque heure.");
    const cadre = el("div", { classe: "graphe", role: "group", "aria-label": "Temps de préparation des pages, heure par heure sur 7 jours : flèches gauche et droite pour lire chaque heure" }, dessin);
    const decrire = (i) => {
      const m = heures[i];
      const debut = Date.parse(m.debut);
      const quand = `${majuscule(jour(debut))}, de ${heure(debut)} à ${heure(debut + HEURE)}`;
      if (m.p95 === null) return [el("strong", {}, quand), " : pas de mesure (serveur arrêté ou mesures pas encore commencées)."];
      return [
        el("strong", {}, quand),
        ` : 19 pages sur 20 en moins de ${secondes(m.p95)}, la moitié en moins de ${secondes(m.p50)}${m.affluence ? ` ; affluence ${NIVEAUX[m.affluence]}` : ""}${m.ralenti ? " ; heure ralentie" : ""}.`,
      ];
    };
    const montrer = (i) => {
      if (i === null) {
        curseur.setAttribute("visibility", "hidden");
        point.setAttribute("visibility", "hidden");
        lecture.removeAttribute("data-actif");
        lecture.textContent = "Passe le doigt, la souris ou les flèches du clavier sur le graphique pour lire chaque heure.";
        return;
      }
      curseur.setAttribute("x1", x(i));
      curseur.setAttribute("x2", x(i));
      curseur.setAttribute("visibility", "visible");
      if (heures[i].p95 !== null) {
        point.setAttribute("cx", x(i));
        point.setAttribute("cy", y(heures[i].p95));
        point.setAttribute("visibility", "visible");
      } else point.setAttribute("visibility", "hidden");
      lecture.setAttribute("data-actif", "");
      lecture.replaceChildren(...decrire(i));
    };
    const poser = lecteur({ cadre, id: "temps", compter: () => heures.length, montrer, etapes: () => ({ page: 24 }) });
    const pointer = (evenement) => {
      const boite = dessin.getBoundingClientRect();
      const echelle = largeur / boite.width;
      const position = (evenement.clientX - boite.left) * echelle;
      poser(Math.floor(((position - marge.gauche) / l) * heures.length));
    };
    cadre.addEventListener("pointermove", pointer);
    cadre.addEventListener("pointerdown", pointer);
    const cles = el(
      "ul",
      { classe: "cles", "aria-label": "Légende du graphique" },
      el("li", {}, el("span", { classe: "cle-trait", "aria-hidden": "true" }), "19 pages sur 20 (p95)"),
      el("li", {}, el("span", { classe: "cle-trait p50", "aria-hidden": "true" }), "La moitié des pages (médiane)"),
      el("li", {}, el("span", { classe: "cle-trait seuil", "aria-hidden": "true" }), `Ralenti au-delà de ${seuil.toLocaleString("fr-FR")}${NB}s`),
      el("li", {}, el("span", { classe: "cle-bande", "aria-hidden": "true" }), "Heure ralentie"),
    );
    const lignes = heures
      .map((m, i) => ({ m, i }))
      .reverse()
      .map(({ m }) => {
        const debut = Date.parse(m.debut);
        return el(
          "tr",
          {},
          el("th", { scope: "row" }, `${majuscule(F_COURT.format(new Date(debut)))}, ${heure(debut)}`),
          el("td", {}, m.p50 === null ? "—" : secondes(m.p50)),
          el("td", {}, m.p95 === null ? "—" : secondes(m.p95)),
          el("td", {}, m.affluence ? NIVEAUX[m.affluence] : "—"),
          el("td", {}, m.ralenti === null ? "—" : m.ralenti ? "oui" : "non"),
        );
      });
    const tableau = el(
      "details",
      {},
      el("summary", {}, "Voir les 7 jours en tableau"),
      el(
        "div",
        { classe: "tableau-cadre" },
        el(
          "table",
          {},
          el("thead", {}, el("tr", {}, ...["Heure", "La moitié en moins de", "19 sur 20 en moins de", "Affluence", "Ralentie"].map((t) => el("th", { scope: "col" }, t)))),
          el("tbody", {}, lignes),
        ),
      ),
    );
    const mesurees = heures.filter((m) => m.p95 !== null);
    const debutMesures = Date.parse(mesurees[0].debut);
    const jeune = mesurees.length < 24
      ? el("p", { classe: "bloc-aide" }, `Mesures depuis ${cleJour(debutMesures) === cleJour(maintenant) ? `aujourd’hui à ${heure(debutMesures)}` : `le ${F_DATE.format(new Date(debutMesures))}`} : le graphique se remplit heure par heure.`)
      : null;
    zone.replaceChildren(el("div", { classe: "panneau" }, jeune, cadre, lecture, cles, tableau));
  }

  // ---------- Affluence et semaine type ----------
  const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  const JOURS_COURTS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
  const COMPARAISON = {
    calme: "plus calme que d’habitude à cette heure-ci",
    habituelle: "habituelle pour cette heure-ci",
    forte: "plus forte que d’habitude à cette heure-ci",
    "tres-forte": "très forte : bien plus de monde que d’habitude à cette heure-ci",
  };
  const finHeure = (h) => (h === 24 ? "minuit" : `${h}${NB}h`);

  function phraseAffluence() {
    const api = donnees.api;
    if (!api) return donnees.apiErreur === "absente" ? "Les mesures d’affluence ne sont pas encore publiées." : "Les mesures d’affluence sont indisponibles pendant que festisyn.com ne répond pas à cette page.";
    const m = api.maintenant;
    const morceaux = [];
    if (m?.affluence) morceaux.push(`En ce moment, l’affluence est ${COMPARAISON[m.affluence]}.`);
    else morceaux.push("Pas encore assez de mesures pour comparer l’affluence du moment aux jours précédents.");
    if (m?.refus) morceaux.push("Le site refuse quelques visiteurs quelques secondes pour ne pas tomber : réessaie un peu plus tard si tu vois « réessaie dans quelques secondes ».");
    else if (m?.ralenti) morceaux.push("Le site est ralenti.");
    return morceaux.join(" ");
  }

  function phraseHeuresChargees(cases, joursMesures) {
    const chargees = cases.filter((c) => c.affluence === "forte" || c.affluence === "tres-forte");
    const periode = joursMesures >= 28 ? "ces 4 dernières semaines" : `ces ${joursMesures} derniers jours`;
    if (!chargees.length) return `Aucune heure ne sort du lot ${periode} : l’affluence reste proche de l’habitude toute la semaine.`;
    // Plages d'heures contiguës par jour, puis les jours qui ont la même plage regroupés.
    const plages = new Map();
    for (let j = 1; j <= 7; j++) {
      const heures = chargees.filter((c) => c.jour === j).map((c) => c.heure).sort((a, b) => a - b);
      const morceaux = [];
      for (const h of heures) {
        const dernier = morceaux.at(-1);
        if (dernier && h === dernier[1]) dernier[1] = h + 1;
        else morceaux.push([h, h + 1]);
      }
      for (const [a, b] of morceaux) {
        const cle = `${a}-${b}`;
        plages.set(cle, [...(plages.get(cle) ?? []), j]);
      }
    }
    const groupes = [...plages.entries()]
      .map(([cle, jours]) => ({ a: Number(cle.split("-")[0]), b: Number(cle.split("-")[1]), jours }))
      .sort((p, q) => (q.b - q.a) * q.jours.length - (p.b - p.a) * p.jours.length)
      .slice(0, 3)
      .sort((p, q) => p.jours[0] - q.jours[0] || p.a - q.a);
    const textes = groupes.map((g) => `${liste(g.jours.map((j) => `le ${JOURS[j - 1]}`))} de ${g.a}${NB}h à ${finHeure(g.b)}`);
    const autres = plages.size > groupes.length ? ", entre autres" : "";
    const mediane = (valeurs) => {
      const triees = valeurs.filter((v) => v !== null).sort((a, b) => a - b);
      if (!triees.length) return null;
      const milieu = triees.length / 2;
      return Number.isInteger(milieu) ? (triees[milieu - 1] + triees[milieu]) / 2 : triees[Math.floor(milieu)];
    };
    const p50 = mediane(chargees.map((c) => c.p50));
    const p95 = mediane(chargees.map((c) => c.p95));
    const lentes = chargees.filter((c) => c.ralenti === "souvent" || c.ralenti === "parfois").length;
    const temps = p50 !== null && p95 !== null ? ` À ces heures, la moitié des pages se préparent en moins de ${secondes(p50)}, et 19 sur 20 en moins de ${secondes(p95)}` : " À ces heures";
    const ralenti = lentes === 0 ? ` ; le site n’y a pas été ralenti ${periode}.` : lentes === chargees.length ? ` ; le site y est souvent ralenti.` : ` ; le site y a parfois été ralenti.`;
    return `Heures chargées ${periode} : ${liste(textes)}${autres}.${temps}${ralenti}`;
  }

  function rendreAffluence() {
    document.getElementById("affluence-maintenant").textContent = typo(phraseAffluence());
    const zone = document.getElementById("semaine-type");
    const semaine = donnees.api?.semaineType ?? null;
    if (!semaine) {
      zone.replaceChildren(el("div", { classe: "panneau vide" }, "La semaine type revient quand festisyn.com répond."));
      return;
    }
    const cases = semaine.cases;
    const remplie = cases.some((c) => c.affluence);
    if (!remplie) {
      const deja = semaine.jours ? ` (${semaine.jours} jour${semaine.jours > 1 ? "s" : ""} pour l’instant)` : "";
      zone.replaceChildren(
        el(
          "div",
          { classe: "panneau" },
          el("p", {}, `La semaine type se dessine après 7 jours de mesures${deja}. Elle montrera, pour chaque heure de la semaine, l’affluence habituelle et si le site y est souvent ralenti.`),
        ),
      );
      return;
    }
    const grille = el("div", { classe: "grille-semaine", "aria-hidden": "true" });
    for (let j = 1; j <= 7; j++) grille.append(el("span", { classe: "nom-jour", vars: { "--j": j } }, JOURS_COURTS[j - 1]));
    for (let h = 0; h < 24; h++) grille.append(el("span", { classe: `nom-heure${h % 3 ? " secondaire" : ""}`, vars: { "--h": h } }, `${h}${NB}h`));
    const noeuds = cases.map((c) =>
      el("span", { classe: "case", vars: { "--j": c.jour, "--h": c.heure }, "data-niveau": c.affluence ?? null }, c.ralenti === "souvent" || c.ralenti === "parfois" ? el("span", { classe: "marque", "data-ralenti": c.ralenti }) : null),
    );
    grille.append(...noeuds);
    const lecture = el("p", { classe: "lecture", "aria-live": "polite" }, "Passe le doigt, la souris ou les flèches du clavier sur la grille pour lire chaque heure.");
    const cadre = el("div", { classe: "semaine", role: "group", "aria-label": "Semaine type, jour par jour et heure par heure : flèches pour lire chaque heure" }, grille);
    // Ordre de lecture : jour par jour (lundi 0 h, lundi 1 h…), comme les cases.
    const sens = () => (getComputedStyle(grille).getPropertyValue("--sens").trim() === "etroit" ? "colonne" : "ligne");
    const decrire = (i) => {
      const c = cases[i];
      const quand = `${majuscule(JOURS[c.jour - 1])}, de ${c.heure}${NB}h à ${finHeure(c.heure + 1)}`;
      if (!c.affluence) return [el("strong", {}, quand), " : pas encore de mesure."];
      const ralenti = { jamais: "jamais ralenti", parfois: "parfois ralenti", souvent: "souvent ralenti" }[c.ralenti];
      return [el("strong", {}, quand), ` : affluence ${NIVEAUX[c.affluence]}${c.p95 !== null ? ` ; 19 pages sur 20 en moins de ${secondes(c.p95)}, la moitié en moins de ${secondes(c.p50)}` : ""} ; ${ralenti}.`];
    };
    const montrer = (i) => {
      for (const noeud of noeuds) noeud.removeAttribute("data-actif");
      if (i === null) {
        lecture.removeAttribute("data-actif");
        lecture.textContent = "Passe le doigt, la souris ou les flèches du clavier sur la grille pour lire chaque heure.";
        return;
      }
      noeuds[i].setAttribute("data-actif", "");
      lecture.setAttribute("data-actif", "");
      lecture.replaceChildren(...decrire(i));
    };
    // Grille large : gauche et droite changent d'heure, haut et bas de jour. Étroite (jours en colonnes) : l'inverse
    // (« colonne » dans lecteur).
    const poser = lecteur({
      cadre,
      id: "semaine",
      compter: () => cases.length,
      montrer,
      sens,
      etapes: () => ({ travers: 24, page: 24 }),
    });
    const pointer = (evenement) => {
      const cible = document.elementsFromPoint(evenement.clientX, evenement.clientY).find((noeud) => noeud.classList?.contains("case"));
      if (cible) poser(noeuds.indexOf(cible));
    };
    cadre.addEventListener("pointermove", pointer);
    cadre.addEventListener("pointerdown", pointer);
    // Deux rangées voulues : les niveaux d'affluence, puis les ralentissements (une seule rangée laissait un mot seul à la ligne).
    const echelle = el(
      "ul",
      { classe: "echelle", "aria-label": "Légende : niveaux d’affluence" },
      ...["calme", "habituelle", "forte", "tres-forte"].map((n) => el("li", {}, el("span", { classe: "case-ex", "data-niveau": n, "aria-hidden": "true" }), majuscule(NIVEAUX[n]))),
      el("li", {}, el("span", { classe: "case-ex", "data-niveau": "aucun", "aria-hidden": "true" }), "Pas encore de mesure"),
    );
    const marques = el(
      "ul",
      { classe: "echelle", "aria-label": "Légende : ralentissements" },
      el("li", {}, el("span", { classe: "marque", "data-ralenti": "parfois", "aria-hidden": "true" }), "Parfois ralenti à cette heure"),
      el("li", {}, el("span", { classe: "marque", "data-ralenti": "souvent", "aria-hidden": "true" }), "Souvent ralenti à cette heure"),
    );
    const phrase = el(
      "p",
      { classe: "semaine-phrase" },
      remplie
        ? phraseHeuresChargees(cases, semaine.jours)
        : `La semaine type se dessine après 7 jours de mesures${semaine.jours ? ` (${semaine.jours} jour${semaine.jours > 1 ? "s" : ""} pour l’instant)` : ""}. Chaque case comparera une heure de la semaine à une heure ordinaire.`,
    );
    const aide = el("p", { classe: "bloc-aide" }, `Chaque case : l’affluence habituelle de cette heure de la semaine, comparée à une heure ordinaire, d’après ${semaine.jours >= 28 ? "les 4 dernières semaines" : `les ${semaine.jours} derniers jours`}. Heures de Paris.`);
    const tableau = remplie
      ? el(
          "details",
          {},
          el("summary", {}, "Voir la semaine type en tableau"),
          el(
            "div",
            { classe: "tableau-cadre" },
            el(
              "table",
              {},
              el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Heure"), ...JOURS.map((j) => el("th", { scope: "col" }, majuscule(j))))),
              el(
                "tbody",
                {},
                Array.from({ length: 24 }, (_, h) =>
                  el(
                    "tr",
                    {},
                    el("th", { scope: "row" }, `${h}${NB}h`),
                    ...Array.from({ length: 7 }, (_, j) => {
                      const c = cases.find((x) => x.jour === j + 1 && x.heure === h);
                      return el("td", {}, c?.affluence ? `${NIVEAUX[c.affluence]}${c.p95 !== null ? `, ${secondes(c.p95)}` : ""}${c.ralenti === "jamais" || !c.ralenti ? "" : `, ${c.ralenti} ralenti`}` : "—");
                    }),
                  ),
                ),
              ),
            ),
          ),
        )
      : null;
    zone.replaceChildren(el("div", { classe: "panneau" }, aide, cadre, lecture, echelle, marques, phrase, tableau));
  }

  // ---------- Incidents ----------
  function rendreIncidents(maintenant) {
    const zone = document.getElementById("liste-incidents");
    const info = donnees.incidentsInfo;
    const avis = [];
    if (info.limite) {
      avis.push(
        el(
          "p",
          { classe: "avis" },
          `GitHub limite les lectures depuis ton adresse (60 par heure) : la liste revient vers ${heure(info.jusqua)}. `,
          donnees.incidents && info.lu ? `Voici celle lue à ${heure(info.lu)}. ` : "",
          el("a", { href: PAGE_INCIDENTS }, "Lire les incidents sur GitHub"),
        ),
      );
    } else if (info.erreur) {
      avis.push(el("p", { classe: "avis" }, `La liste des incidents ne se charge pas pour l’instant${donnees.incidents && info.lu ? ` ; voici celle lue à ${heure(info.lu)}` : ""}. `, el("a", { href: PAGE_INCIDENTS }, "Lire les incidents sur GitHub")));
    }
    if (!donnees.incidents) {
      zone.replaceChildren(avis.length ? el("div", { classe: "panneau panneau-liste" }, avis) : el("div", { classe: "panneau" }, el("p", { classe: "vide" }, "Les incidents se chargent.")));
      return;
    }
    const jours = derniersJours(7, maintenant).reverse();
    const nom = Object.fromEntries(ELEMENTS.map((e) => [e.slug, e.nom]));
    const blocs = jours.map((j) => {
      const duJour = donnees.incidents.filter((incident) => incident.debut >= j.debut && incident.debut < j.fin).sort((a, b) => b.debut - a.debut);
      const titre = cleJour(j.debut) === cleJour(maintenant) ? `Aujourd’hui, ${jour(j.debut)}` : majuscule(jour(j.debut));
      return el(
        "div",
        { classe: "jour-incidents" },
        el("h3", {}, titre),
        duJour.length
          ? duJour.map((incident) => {
              const enCours = !incident.fin;
              const fin = incident.fin ?? maintenant;
              const memeJour = cleJour(incident.debut) === cleJour(fin);
              const plage = enCours
                ? `En cours depuis ${heure(incident.debut)} (${duree(maintenant - incident.debut)}).`
                : memeJour
                  ? `De ${heure(incident.debut)} à ${heure(fin)}, résolu en ${duree(fin - incident.debut)}.`
                  : `Du ${F_DATE.format(new Date(incident.debut))} à ${heure(incident.debut)} au ${F_DATE.format(new Date(fin))} à ${heure(fin)}, résolu en ${duree(fin - incident.debut)}.`;
              const couvert = couvertParSite(incident, maintenant);
              const sorte = couvert ? "inconnu" : incident.sorte;
              const titre = couvert ? "Non vérifiable" : incident.sorte === "panne" ? "Panne" : "Ralentissement";
              return el(
                "div",
                { classe: "incident", "data-etat": sorte },
                icone(sorte),
                el("p", { classe: "incident-titre" }, `${titre} : ${nom[incident.slug]}`),
                el("p", { classe: "incident-detail" }, `${couvert ? "Pendant la panne du site. " : ""}${plage} `, el("a", { href: incident.url }, `Incident n°${NB}${incident.n} sur GitHub`)),
              );
            })
          : el("p", { classe: "aucun" }, "Aucun incident."),
      );
    });
    zone.replaceChildren(el("div", { classe: "panneau panneau-liste" }, avis, blocs), el("p", { classe: "incidents-note" }, el("a", { href: PAGE_INCIDENTS }, "Tous les incidents, plus anciens compris, sur GitHub")));
  }

  // ---------- Ensemble ----------
  function rendre() {
    const maintenant = Date.now();
    const focus = document.activeElement?.dataset?.lecteur ?? null;
    const etats = rendreElements(maintenant);
    rendreBandeau(etats, maintenant);
    rendreTemps(maintenant);
    rendreAffluence();
    rendreIncidents(maintenant);
    document.getElementById("pied-maj").textContent = `Mis à jour à ${heure(donnees.lu ?? maintenant)}. Cette page se met à jour toute seule chaque minute.`;
    if (focus) document.querySelector(`[data-lecteur="${focus}"]`)?.focus({ preventScroll: true });
  }

  let tours = 0;
  async function rafraichir() {
    const incidentsAussi = tours % 5 === 0 || !donnees.incidents;
    tours++;
    await toutLire(incidentsAussi);
    rendre();
  }

  let enCours = null;
  const lancer = () => {
    enCours ??= rafraichir().finally(() => {
      enCours = null;
    });
    return enCours;
  };
  lancer();
  setInterval(() => {
    if (document.visibilityState === "visible") lancer();
  }, RAFRAICHIR_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && donnees.lu && Date.now() - donnees.lu > RAFRAICHIR_MS) lancer();
  });
  // Le graphique se redessine à la largeur de son bloc.
  let largeurVue = 0;
  const observateur = new ResizeObserver((entrees) => {
    const largeur = Math.round(entrees[0].contentRect.width);
    if (Math.abs(largeur - largeurVue) < 8 || !donnees.lu) return;
    largeurVue = largeur;
    rendreTemps(Date.now());
  });
  observateur.observe(document.getElementById("graphique-temps"));
})();
