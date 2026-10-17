/* Demo del asistente de HE Signal para «Box Norte» (box ficticio).
   Funciona entero en el navegador, con respuestas preparadas: sin servidor y sin coste. */
(function () {
  'use strict';

  /* ---------- Datos del box (ficticio) ---------- */
  var BOX = {
    nombre: 'Box Norte',
    coach: 'Marc',
    coach2: 'Laia',
    dias: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
    // clases por día (0 = lunes)
    clases: {
      0: ['7:00', '8:00', '13:30', '18:00', '19:00', '20:00', '21:00'],
      1: ['7:00', '8:00', '13:30', '18:00', '19:00', '20:00', '21:00'],
      2: ['7:00', '8:00', '13:30', '18:00', '19:00', '20:00', '21:00'],
      3: ['7:00', '8:00', '13:30', '18:00', '19:00', '20:00', '21:00'],
      4: ['7:00', '8:00', '13:30', '18:00', '19:00', '20:00'],
      5: ['10:00', '11:00'],
      6: []
    },
    iniciacion: [[1, '19:00'], [3, '20:00']] // martes 19:00 y jueves 20:00
  };

  /* ---------- Utilidades ---------- */
  var $ = function (s) { return document.querySelector(s); };
  function norm(t) { return (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  function has(t, re) { return re.test(t); }
  function hora() { return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  var usados = {};
  function una(clave, opciones) {
    // elige una variante distinta de la última usada para esa clave
    var prev = usados[clave], i, n = opciones.length;
    do { i = Math.floor(Math.random() * n); } while (n > 1 && i === prev);
    usados[clave] = i;
    return opciones[i];
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ---------- Estado ---------- */
  var st;
  function reset() {
    st = {
      ca: false, saludado: false, reservando: false, preguntoLesion: false, cerrado: false,
      lead: { nombre: '', interes: [], nivel: '', dia: null, hora: '', clase: '', aviso: '', estado: 'Nuevo' },
      consultas: 0, pruebas: 0, tiempos: [], busy: false, historial: [], ultimo: ''
    };
  }

  /* ---------- Detección ---------- */
  var RE = {
    saludo: /\b(hola+|holi+|ola|buenas+|buenos dias|buenas tardes|buenas noches|hey+|ey|bon dia|bona tarda|bona nit|ei|que tal)\b/,
    precio: /(precio|cuanto (cuesta|vale|es|sale)|cuesta|tarifa|cuota|mensualidad|preu|quant (costa|val)|€|euros|caro|barato)/,
    horario: /(horario|horari|a que hora|que horas|abris|abren|cerrais|cierran|obriu|tanqueu|clases hay|hay clase|por la manana|por la tarde|por la noche|al mediodia|fin de semana|findes?)/,
    prueba: /(prueba|probar|provar|prova|primera clase|ir a ver|venir a ver|apuntar|apunto|apuntarme|reservar|reserva|inscrib|empezar ya|quiero empezar|quiero ir|quiero venir|como empiezo|gratis|gratuit)/,
    principiante: /(nunca|no he hecho|jamas|principiante|desde cero|de cero|novato|novata|no estoy en forma|forma fisica|baja forma|sedentari|no se si podre|podre|nivel|mi edad|tengo \d{2} anos|mayor|gordo|gorda|sobrepeso|mai he fet)/,
    experto: /(ya he hecho|he hecho crossfit|hago crossfit|vengo de otro box|entreno (crossfit|hace)|tengo experiencia|llevo \w+ (anos|meses))/,
    lesion: /(lesion|lesionad|rodilla|espalda|lumbar|hombro|tobillo|munec|cadera|cervical|hernia|operad|dolor|me duele|embaraz|tendin|esguince|lesio|genoll|esquena)/,
    ninos: /(\bhijo|\bhija|\bnino|\bnina|\bninos|adolescente|teen|chaval|crio|fill|\bnen\b|\bnena\b)/,
    ubicacion: /(donde (estais|esta|queda)|direccion|ubicacion|como llego|metro|parking|aparcar|aparcamiento|bici|on (sou|esteu))/,
    material: /(que (traigo|llevo|tengo que llevar|necesito)|traer|ropa|zapatilla|calzado|material|toalla|ducha|vestuario|taquilla|candado|guantes)/,
    permanencia: /(permanencia|baja|darme de baja|contrato|matricula|compromiso|cancelar)/,
    suelta: /(clase suelta|una sola clase|drop ?in|bono|un dia suelto|pase de dia)/,
    clase: /(como (es|son) (una |las )?clase|que se hace|cuanto dura|cuantas personas|cuanta gente|grupos? (de|pequen)|wod)/,
    objetivo: /(perder peso|adelgaz|bajar de peso|quemar|ganar (fuerza|musculo|masa)|ponerme en forma|tonificar|definir|resistencia|cardio)/,
    hoy: /(hay clase hoy|clases? hoy|hoy hay|hoy a que|esta tarde hay|esta noche hay|ahora hay|avui hi ha)/,
    bot: /(\bbot\b|robot|\bia\b|inteligencia artificial|persona real|eres (una )?persona|eres humano|eres real|maquina|automatic|chatgpt|ets un)/,
    humano: /(hablar con (alguien|una persona|el coach|marc)|llamad|llamarme|telefono|whatsapp de alguien|persona de verdad)/,
    gracias: /(gracias|grcs|merci|thanks|mil gracias|grac)/,
    despedida: /(adios|hasta luego|hasta pronto|nos vemos|chao|chau|bye|adeu|fins aviat)/,
    si: /^(si|sip|sii+|vale|ok|okay|claro|perfecto|genial|venga|dale|de acuerdo|va|d'acord|perfecte|si porfa|si por favor)\b/,
    no: /^(no|nop|nope|para nada|ninguna|nada|ningun|cap)\b/,
    catalan: /\b(bon dia|bona tarda|bona nit|teniu|voldria|vull|puc|quant|classe|gracies|merci|sou|esteu|fer|dimarts|dijous|dilluns|dimecres|divendres|dissabte|aquesta|setmana|provar|mai)\b/
  };

  var DIAS_RE = [
    [/\b(lunes|dilluns)\b/, 0], [/\b(martes|dimarts)\b/, 1], [/\b(miercoles|dimecres)\b/, 2],
    [/\b(jueves|dijous)\b/, 3], [/\b(viernes|divendres)\b/, 4], [/\b(sabado|dissabte)\b/, 5], [/\b(domingo|diumenge)\b/, 6]
  ];
  function hoyIdx() { return (new Date().getDay() + 6) % 7; }
  function sacarDia(t) {
    for (var i = 0; i < DIAS_RE.length; i++) if (DIAS_RE[i][0].test(t)) return DIAS_RE[i][1];
    if (/\bpasado manana\b/.test(t)) return (hoyIdx() + 2) % 7;
    if (/\b(hoy|avui|esta tarde|esta noche)\b/.test(t)) return hoyIdx();
    if (/\b(manana|dema)\b/.test(t) && !/\bpor la manana\b|\bde manana\b|\bmananas\b/.test(t)) return (hoyIdx() + 1) % 7;
    return null;
  }
  function sacarHora(t) {
    var m = t.match(/\b(?:a las |sobre las |las |a les |les )?([01]?\d|2[0-3])(?:[:.h]([0-5]\d))?\s*(?:h\b|hrs?\b|horas\b)?/);
    // evita confundir edades o cantidades: exige contexto horario
    if (m && (/\b(a las|sobre las|las|a les|les)\s*\d/.test(t) || /\d\s*(h\b|:\d\d|hrs?\b|horas\b)/.test(t))) {
      var h = parseInt(m[1], 10), mi = m[2] || '00';
      if (h < 7 && !/manana/.test(t)) h += 12;
      return h + ':' + mi;
    }
    if (/por la manana|primera hora|matins|al mati/.test(t)) return 'manana';
    if (/mediodia|al migdia/.test(t)) return 'mediodia';
    if (/por la tarde|a la tarde|tarda/.test(t)) return 'tarde';
    if (/por la noche|de noche|nit/.test(t)) return 'noche';
    return '';
  }
  function sacarNombre(raw, t) {
    var m = raw.match(/(?:me llamo|soy|mi nombre es|em dic|sóc|soc)\s+([A-Za-zÁÉÍÓÚÑÀÈÒÏÜÇáéíóúñàèòïüç]+(?:\s+[A-Za-zÁÉÍÓÚÑÀÈÒÏÜÇáéíóúñàèòïüç]+)?)/i);
    if (m) return limpiaNombre(m[1]);
    // respuesta corta a "¿a nombre de quién?"
    if (st.esperando === 'nombre' || (st.reservando && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñüç]+(\s[A-ZÁÉÍÓÚÑ][a-záéíóúñüç]+)?$/.test(raw.trim()) && sacarDia(t) === null && !RE.si.test(t) && !RE.no.test(t) && !RE.saludo.test(t) && !RE.gracias.test(t))) {
      var w = raw.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/);
      if (w.length && w.length <= 3 && w[0].length > 1 && !RE.si.test(t) && !RE.no.test(t)) return limpiaNombre(w.slice(0, 2).join(' '));
    }
    return '';
  }
  function limpiaNombre(s) {
    var malas = /^(de|el|la|nuevo|nueva|principiante|interesado|interesada|un|una|muy|bastante|crossfitero)$/i;
    var p = s.split(/\s+/).filter(function (w) { return !malas.test(w); });
    return p.map(function (w) { return cap(w.toLowerCase()); }).join(' ');
  }

  /* ---------- Textos ---------- */
  function T(es, ca) { return st.ca && ca ? ca : es; }
  function nombreCorto() { return st.lead.nombre ? st.lead.nombre.split(' ')[0] : ''; }
  function huecosDia(d) { return BOX.clases[d] || []; }
  var DIAS_CA = ['dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge'];
  function textoDia(d) {
    if (st.ca) return d === hoyIdx() ? 'avui' : d === (hoyIdx() + 1) % 7 ? 'demà' : 'el ' + DIAS_CA[d];
    return d === hoyIdx() ? 'hoy' : d === (hoyIdx() + 1) % 7 ? 'mañana' : 'el ' + BOX.dias[d];
  }
  function esIniciacion(d, h) { return BOX.iniciacion.some(function (x) { return x[0] === d && x[1] === h; }); }
  function horaEnFranja(franja, d) {
    var hs = huecosDia(d);
    var f = { manana: function (h) { return parseInt(h, 10) < 12; }, mediodia: function (h) { var n = parseInt(h, 10); return n >= 12 && n < 16; },
      tarde: function (h) { var n = parseInt(h, 10); return n >= 16 && n < 20; }, noche: function (h) { return parseInt(h, 10) >= 20; } }[franja];
    return f ? hs.filter(f) : [];
  }

  function clasesRestantesHoy() {
    var ahora = new Date(), min = ahora.getHours() * 60 + ahora.getMinutes();
    return huecosDia(hoyIdx()).filter(function (h) { var p = h.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10) > min + 15; });
  }
  function listaHoras(hs) { return hs.join(', ').replace(/, ([^,]*)$/, ' y $1'); }


  /* ---------- Ficha del box: preguntas frecuentes con búsqueda tolerante ---------- */
  var KB = [
    { id: 'actividades', label: 'Actividades', keys: ['actividad', 'que haceis', 'que ofreceis', 'que clases', 'tipos de clase', 'disciplina', 'modalidad', 'que teneis', 'que se puede hacer', 'que hay en el', 'servicios'],
      r: [['Además de CrossFit, tenemos unas cuantas cosas:', 'Iniciación para empezar de cero, Hyrox, halterofilia, open box y CrossFit Teens.', 'Y los sábados, movilidad, que va genial para recuperar.', '¿Te interesa alguna en concreto?'],
          ['Te cuento lo que hay:', 'CrossFit (con Iniciación si empiezas de cero), Hyrox Prep, halterofilia, open box por las tardes, Teens y movilidad.', '¿Cuál te llama más?']] },
    { id: 'quees', label: 'Qué es CrossFit', keys: ['que es crossfit', 'que es el crossfit', 'que es eso del crossfit', 'en que consiste', 'que es un box'],
      r: [['Es entrenamiento funcional en grupo: fuerza, cardio y movimientos del día a día, todo mezclado.', 'Cada día hay un entreno distinto, así que no te aburres.', 'Y se adapta a cualquier nivel, por eso viene gente de todas las edades.', 'Una clase dura una hora: calentamiento, técnica y el entreno del día.']] },
    { id: 'hyrox', label: 'Hyrox', keys: ['hyrox', 'hirox', 'hyros', 'hairox', 'carrera', 'correr', 'running'],
      r: [['¡Sí! Tenemos Hyrox Prep 🏃', 'Martes y jueves a las 21:00, y el sábado a las 11:00.', 'Trabajamos las 8 estaciones y la carrera, y de vez en cuando hacemos un simulacro de competición.', 'Va incluido en el ilimitado. ¿Has hecho alguna Hyrox o sería la primera?'],
          ['Sí, hacemos Hyrox.', 'Hay clase específica martes y jueves a las 21:00 y sábado a las 11:00.', 'Sirve tanto si quieres competir como si solo buscas un entreno distinto.', '¿Te reservo una para probarla?']] },
    { id: 'halterofilia', label: 'Halterofilia', keys: ['halterofilia', 'halterofil', 'olimpic', 'arrancada', 'envion', 'dos tiempos', 'snatch', 'levantamiento', 'pesas'],
      r: [['Sí, los miércoles a las 20:00 hay halterofilia.', 'Técnica de arrancada y dos tiempos, en grupo pequeño.', 'Si nunca has levantado, lo suyo es empezar por las clases normales y luego pasarte.']] },
    { id: 'openbox', label: 'Open box', keys: ['open box', 'openbox', 'por mi cuenta', 'entrenar solo', 'entrenar sola', 'sala libre', 'por libre', 'a mi aire'],
      r: [['Sí, hay open box de lunes a viernes de 15:00 a 17:00.', 'Vienes a entrenar a tu aire con todo el material del box.', 'Va incluido en la cuota ilimitada.']] },
    { id: 'movilidad', label: 'Movilidad', keys: ['movilidad', 'estiramiento', 'estirar', 'flexibilidad', 'yoga', 'pilates', 'stretching'],
      r: [['Los sábados a las 12:00 hay movilidad.', 'Una hora tranquila de estiramientos y movilidad, perfecta para recuperar.', 'Yoga o pilates como tal no hacemos, eso sí.']] },
    { id: 'pago', label: 'Formas de pago', keys: ['bizum', 'tarjeta', 'efectivo', 'domicili', 'transferencia', 'recibo', 'como se paga', 'forma de pago', 'formas de pago', 'como pago'],
      r: [['La cuota se paga por domiciliación o con tarjeta, a principio de mes.', 'Las clases sueltas también te las puedes pagar con Bizum.']] },
    { id: 'descuento', label: 'Descuentos', keys: ['descuento', 'oferta', 'promo', 'rebaja', 'estudiante', 'pareja', 'amigo', 'amiga', 'familia', '2x1', 'dos personas'],
      r: [['Si os apuntáis dos (pareja, amigos o familia), tenéis un 10% cada uno.', 'Y si eres estudiante, otro 10% enseñando el carnet.', 'La primera clase, como siempre, gratis.']] },
    { id: 'coaches', label: 'Coaches', keys: ['coaches', 'entrenador', 'monitor', 'profe', 'profesor', 'quien da', 'quienes sois', 'titulacion', 'certificad', 'titulad'],
      r: [['Somos dos coaches: Marc, el head coach, y Laia.', 'Los dos con el Level 2 de CrossFit y unos cuantos años dando clase.', 'Laia lleva además los Teens y la movilidad.']] },
    { id: 'app', label: 'App y aforo', keys: ['app', 'aplicacion', 'aforo', 'cuantas plazas', 'se llena', 'se llenan', 'reservar las clases', 'como se reservan'],
      r: [['Las clases se reservan desde la app del box, se tarda nada.', 'Somos 12 como máximo por clase.', 'Las de las 19 y 20h se llenan antes, así que mejor reservarlas el día anterior.']] },
    { id: 'frecuencia', label: 'Cuántos días entrenar', keys: ['cuantas veces', 'cuantos dias', 'dias a la semana', 'dias por semana', 'cada cuanto', 'frecuencia'],
      r: [['Para empezar, 2 o 3 días a la semana está perfecto.', 'Así el cuerpo se adapta y no acabas reventado la primera semana.', 'Cuando cojas ritmo, ya decides si te pasas al ilimitado.']] },
    { id: 'miedo', label: 'Dudas de principiante', keys: ['peligroso', 'lesionarme', 'hacerme dano', 'muy duro', 'es duro', 'dificil', 'miedo', 'verguenza', 'no estoy en forma', 'baja forma', 'no podre', 'no voy a poder', 'nivel muy bajo'],
      r: [['Es de las preguntas más habituales, tranqui.', 'Todo se adapta a tu nivel: el peso, las repeticiones y los ejercicios.', 'El coach está encima de la técnica para que no te hagas daño.', 'La mayoría de la gente del box empezó sin haber hecho nunca nada parecido.']] },
    { id: 'edad', label: 'Edad', keys: ['edad maxima', 'muy mayor', 'soy mayor', 'jubilad', 'con mi edad', 'a mi edad', 'tarde para empezar', 'demasiado mayor', 'es tarde'],
      r: [['No hay edad máxima.', 'Tenemos gente de más de 60 entrenando, cada uno a su ritmo.', 'Lo importante es empezar adaptado, y para eso está la clase de Iniciación.']] },
    { id: 'festivos', label: 'Festivos y verano', keys: ['agosto', 'verano', 'festivo', 'navidad', 'vacaciones', 'puente', 'semana santa'],
      r: [['En festivos solemos hacer una sola clase, a las 10:00.', 'Y en agosto cerramos la segunda quincena.', 'Lo avisamos siempre con tiempo por Instagram y por la app.']] },
    { id: 'nutricion', label: 'Nutrición', keys: ['dieta', 'nutricion', 'nutricionista', 'alimentacion', 'suplement', 'proteina', 'que como'],
      r: [['Nutricionista en el box no tenemos.', 'Pero Marc trabaja con una de confianza y, si quieres, te pasa el contacto.']] },
    { id: 'fisio', label: 'Fisio', keys: ['fisio', 'masaje', 'osteopat', 'quiropract'],
      r: [['Fisio en el box no hay, pero colaboramos con una clínica del barrio.', 'Si te hace falta, Marc te pasa el contacto.']] },
    { id: 'competir', label: 'Competiciones', keys: ['competir', 'competicion', 'campeonato', 'torneo', 'el open'],
      r: [['Sí, varias veces al año vamos en grupo a competiciones locales, sobre todo por parejas.', 'Y el Open de CrossFit lo hacemos todos juntos en el box.', 'Nadie está obligado, eh: es para quien le apetezca.']] },
    { id: 'menu', label: '', keys: ['que me puedes decir', 'que me puedes contar', 'que sabes', 'en que me ayudas', 'en que me puedes ayudar', 'que puedo preguntar', 'informacion', 'info', 'cuentame', 'dime algo', 'ayuda', 'mas info'],
      r: [['Pues casi todo lo del box 🙂', 'Precios, horarios, qué clases hay (CrossFit, Hyrox, halterofilia…), cómo es la primera clase o qué tienes que traer.', 'Y si te apetece, te reservo una clase de prueba gratis.', '¿Por dónde empezamos?'],
          ['Te puedo contar lo que quieras del box:', 'precios, horarios, actividades, coaches, cómo funciona la primera clase…', '¿Qué te interesa más?']] }
  ];

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    var p = [], i, j;
    for (j = 0; j <= b.length; j++) p[j] = j;
    for (i = 1; i <= a.length; i++) {
      var prev = p[0]; p[0] = i;
      for (j = 1; j <= b.length; j++) {
        var tmp = p[j];
        p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return p[b.length];
  }
  function buscarKB(t) {
    var palabras = t.replace(/[^a-z0-9ñç ]/g, ' ').split(/\s+/).filter(Boolean);
    var res = [];
    KB.forEach(function (e) {
      var score = 0;
      e.keys.forEach(function (k) {
        if (k.indexOf(' ') !== -1) { if ((' ' + t + ' ').indexOf(' ' + k) !== -1) score += 2; return; }
        if (palabras.some(function (w) { return w === k || (k.length >= 4 && w.indexOf(k) === 0) || (k.length >= 5 && w.length >= 5 && lev(w, k) <= 1); })) score += 1;
      });
      if (score) res.push({ e: e, score: score });
    });
    res.sort(function (a, b) { return b.score - a.score; });
    return res.map(function (x) { return x.e; });
  }

  var R = {
    saludo: function () {
      return una('saludo', T([
        ['¡Buenas! Soy el asistente de Box Norte.', 'Cuéntame, ¿en qué te ayudo?'],
        ['¡Hola! 👋', 'Aquí Box Norte. ¿Qué te gustaría saber?'],
        ['Hola, ¿qué tal?', 'Dime y te cuento lo que necesites del box.']
      ], [['Bon dia! Sóc l\'assistent de Box Norte.', 'Explica\'m, en què et puc ajudar?']]));
    },
    precio: function () {
      return una('precio', T([
        ['Te cuento, tenemos tres cuotas:', '2 días a la semana, 65 €/mes\n3 días, 79 €/mes\nIlimitado, 89 €/mes', 'Sin matrícula y sin permanencia.', 'Y la primera clase es gratis, por si quieres probar antes de decidir.'],
        ['Pues mira, depende de cuántos días vengas.', 'Con 2 días a la semana son 65 € al mes, con 3 días 79 € y el ilimitado 89 €.', 'No hay matrícula ni permanencia 🙂', '¿Cuántos días te gustaría entrenar?']
      ], [['T\'explico, tenim tres quotes:', '2 dies a la setmana, 65 €/mes\n3 dies, 79 €/mes\nIl·limitat, 89 €/mes', 'Sense matrícula ni permanència.', 'I la primera classe és gratis, per si vols provar abans.']]));
    },
    horario: function () {
      return una('horario', T([
        ['Entre semana hay clases a las 7, a las 8 y a las 13:30.', 'Y por la tarde a las 18, 19, 20 y 21h (el viernes la última es a las 20h).', 'Los sábados a las 10 y a las 11. El domingo descansamos.', '¿Te va mejor por la mañana o por la tarde?'],
        ['Abrimos de lunes a sábado.', 'De lunes a viernes: 7, 8, 13:30, 18, 19, 20 y 21h. El viernes acabamos a las 20h.', 'Sábados a las 10 y a las 11.', '¿Qué horario te encaja más?']
      ], [['Entre setmana fem classes a les 7, a les 8 i a les 13:30.', 'I a la tarda a les 18, 19, 20 i 21h (divendres l\'última és a les 20h).', 'Dissabte a les 10 i a les 11. Diumenge descansem.', 'Et va millor al matí o a la tarda?']]));
    },
    hoy: function () {
      var r = clasesRestantesHoy();
      if (r.length) return [una('hoy1', ['¡Sí! Hoy aún quedan clases a las ' + listaHoras(r) + '.', 'Hoy todavía tienes a las ' + listaHoras(r) + '.']), '¿Te apunto a alguna para probar?'];
      var d = (hoyIdx() + 1) % 7; while (!huecosDia(d).length) d = (d + 1) % 7;
      return ['Hoy ya no quedan clases.', 'La siguiente es ' + textoDia(d) + ' a las ' + huecosDia(d)[0] + '.', '¿Quieres que te reserve una para probar?'];
    },
    clase: function () {
      return una('clase', [
        ['Las clases duran una hora.', 'Empezamos calentando, luego trabajamos la técnica del movimiento del día y al final va el entreno (el WOD).', 'Somos como mucho 12 por clase, así que el coach te ve bien y te corrige.'],
        ['Una hora en total.', 'Calentamiento, técnica y el entreno del día.', 'Grupos de 12 personas como máximo, nada de clases masificadas.', 'Y cada ejercicio se adapta a tu nivel.']
      ]);
    },
    objetivo: function () {
      return una('obj', [
        ['Para eso va muy bien, la verdad.', 'Combina fuerza y cardio, y entrenando en grupo cuesta mucho menos ser constante.', 'El primer día Marc te pregunta qué buscas y te orienta.'],
        ['Mucha gente viene justo por eso.', 'Con 2 o 3 días a la semana ya se nota bastante.', 'Lo importante es la constancia, y el grupo ayuda un montón.']
      ]);
    },
    suelta: function () {
      return ['Clase suelta son 15 €.', 'Y hay un bono de 10 clases por 120 €, para usarlo en 3 meses.', 'Va bien si viajas mucho o tienes horarios cambiantes.'];
    },
    ubicacion: function () {
      return ['Estamos en el Carrer de la Demo, 12, en el Poblenou.', '(Dirección de ejemplo, que el box es ficticio 😄)', 'Para aparcar hay zona azul en la calle, y dentro tenemos sitio para bicis.'];
    },
    material: function () {
      return una('mat', [
        ['Nada especial.', 'Ropa cómoda, zapatillas planas y una botella de agua.', 'Hay duchas y taquillas, así que si vienes del curro te puedes cambiar aquí.', 'Eso sí, trae candado y toalla.'],
        ['Con ropa cómoda, zapatillas planas y agua vas sobrado.', 'Tenemos duchas y taquillas (trae tu candado y una toalla).']
      ]);
    },
    permanencia: function () {
      return una('perm', [
        ['Ni matrícula ni permanencia.', 'Si un mes no puedes venir, avisas antes del día 25 y listo.'],
        ['Nada de permanencia.', 'Te das de baja cuando quieras, solo avisando antes del 25 del mes.']
      ]);
    },
    ninos: function (raw) {
      var m = norm(raw).match(/\b(\d{1,2})\s*(anos|any|anys)?\b/), e = m ? parseInt(m[1], 10) : 0;
      if (e >= 12 && e <= 16) return ['Con ' + e + ' años le va perfecto CrossFit Teens.', 'Es los miércoles y viernes a las 17:30, en grupos pequeños y con Laia.', 'La primera clase también es gratis. ¿Le apunto un día?'];
      if (e > 16) return ['Con ' + e + ' años ya puede venir a las clases de adultos, sin problema.', '¿Ha hecho crossfit alguna vez?'];
      if (e) return ['Para menores de 12 todavía no tenemos grupo, lo siento.', 'A partir de los 12 está CrossFit Teens, los miércoles y viernes a las 17:30.'];
      return ['Para peques todavía no tenemos grupo.', 'Pero de 12 a 16 años hay CrossFit Teens, los miércoles y viernes a las 17:30.', '¿Qué edad tiene?'];
    },
    bot: function () {
      return una('bot', T([
        ['Sí, soy el asistente virtual del box 🙂', 'Contesto al momento, a cualquier hora.', 'Y si prefieres hablar con Marc o con Laia, me lo dices y te escriben ellos.'],
        ['Soy un asistente virtual, sí.', 'Si en algún momento prefieres que te escriba alguien del equipo, dímelo y se lo paso.']
      ], [['Sí, sóc l\'assistent virtual del box 🙂', 'Si prefereixes parlar amb el Marc o la Laia, m\'ho dius i t\'escriuen ells.']]));
    },
    humano: function () {
      st.lead.aviso = st.lead.aviso || 'Quiere hablar con alguien del equipo';
      st.lead.estado = 'Necesita a una persona';
      log('🙋 Pide hablar con alguien del equipo → aviso a Marc');
      return ['Claro, sin problema.', 'Se lo paso ahora a Marc y te escribe él por aquí en cuanto acabe la clase.',
        nombreCorto() ? 'Le dejo tu nombre para que sepa quién eres.' : '¿Me dices tu nombre para que sepa a quién escribe?'];
    },
    gracias: function () {
      if (st.lead.dia !== null && st.lead.nombre) return una('grx', [['¡A ti! Nos vemos ' + textoDia(st.lead.dia) + ' 💪'], ['Nada, ' + nombreCorto() + '.', '¡Hasta ' + textoDia(st.lead.dia) + '!']]);
      return una('gr', [['¡A ti!', 'Cualquier cosa me escribes, estoy a cualquier hora.'], ['De nada 🙂', 'Si te animas a probar, dímelo y te reservo plaza.']]);
    },
    despedida: function () { return una('bye', [['¡Hasta luego! 👋'], ['¡Que vaya bien!', 'Aquí estamos para lo que necesites.']]); },
    desconocido: function (raw) {
      st.lead.aviso = st.lead.aviso || 'Pregunta sin respuesta: «' + raw.slice(0, 60) + '»';
      log('❓ Pregunta que el asistente no sabe → pasada a Marc');
      return una('unk', [
        ['Mmm, eso en concreto no lo tengo claro y no te quiero decir algo que no es.', 'Se lo paso a Marc y te contesta él por aquí.', 'Mientras, si quieres te cuento precios, horarios o qué actividades hay.'],
        ['Esa se la dejo a Marc, que no me la quiero inventar.', 'Te escribe él en un rato.', 'Si te sirve, mientras te cuento horarios, precios o las clases que tenemos.']
      ]);
    }
  };

  /* ---------- Pulido: frases cortas y emojis con mesura ---------- */
  var EMOJI = /\p{Extended_Pictographic}️?/gu;
  function pulir(partes) {
    var out = [];
    partes.forEach(function (p) {
      p = p.trim(); if (!p) return;
      if (p.length <= 95 || p.indexOf('\n') !== -1) { out.push(p); return; }
      // parte en frases y las agrupa en mensajes cortos
      var frases = p.match(/[^.!?]+[.!?]+(\s*\(?[^\p{L}\d¿¡(]*\)?)?|[^.!?]+$/gu) || [p], cur = '';
      frases.forEach(function (fz) {
        fz = fz.trim();
        if (cur && (cur + ' ' + fz).length > 95) { out.push(cur); cur = fz; } else cur = cur ? cur + ' ' + fz : fz;
      });
      if (cur) out.push(cur);
    });
    // como mucho 6 mensajes
    while (out.length > 6) out.pop();
    // emojis: uno por respuesta como máximo, y no en dos respuestas seguidas (salvo la confirmación)
    var permitido = !st.emojiPrev || out.some(function (x) { return x.indexOf('✅') !== -1 || /^¡Listo/.test(x); });
    var usado = false;
    out = out.map(function (x) {
      var quitadoAlFinal = false;
      var y = x.replace(EMOJI, function (e, pos) {
        if (permitido && !usado) { usado = true; return e; }
        if (x.slice(pos + e.length).trim() === '') quitadoAlFinal = true;
        return '';
      }).replace(/\s+([.,!?)])/g, '$1').replace(/\s{2,}/g, ' ').trim();
      if (quitadoAlFinal && /[\p{L}\d]$/u.test(y)) y += '.';
      return y;
    }).filter(function (x) { return x && !/^[(\s)]*$/.test(x); });
    st.emojiPrev = usado;
    return out;
  }

  /* ---------- Reserva de la clase de prueba ---------- */
  function siguientePasoReserva(previas) {
    var L = st.lead, out = previas || [];
    if (L.dia !== null && !huecosDia(L.dia).length) {
      L.dia = null; L.hora = ''; st.esperando = 'dia';
      out.push(una('cerrado', T(['Uy, el domingo cerramos 😅 ¿Te iría el lunes o el martes?', 'El domingo el box está cerrado. ¿Qué otro día te encaja?'],
        ['Ui, diumenge tanquem 😅 Et aniria bé dilluns o dimarts?'])));
      if (!L.nivel) return out;
    }
    if (!L.nivel) {
      st.esperando = 'nivel'; st.vecesNivel = (st.vecesNivel || 0) + 1;
      if (st.vecesNivel > 2) { L.nivel = 'principiante'; return siguientePasoReserva(out); }
      out.push(una('nivel', T(['¿Has hecho crossfit alguna vez o empezarías de cero?', 'Una pregunta: ¿ya has entrenado crossfit o sería tu primera vez?'],
        ['Has fet crossfit alguna vegada o començaries de zero?'])));
      return out;
    }
    if (L.dia === null) {
      st.esperando = 'dia';
      if (L.nivel === 'principiante') out.push(una('ini', T(['Para empezar de cero lo mejor es la clase de Iniciación: el martes a las 19:00 o el jueves a las 20:00. ¿Cuál te va mejor?',
        'Sin problema, la mayoría empieza así. Te recomiendo Iniciación: martes a las 19:00 o jueves a las 20:00. ¿Qué día te encaja?'],
        ['Per començar de zero el millor és la classe d\'Iniciació: dimarts a les 19:00 o dijous a les 20:00. Quina et va millor?'])));
      else out.push(una('dia', T(['Puedes venir a cualquier clase. ¿Qué día te iría bien?', '¿Qué día te viene mejor? Entre semana hay clases de 7 de la mañana a 21h.'],
        ['Pots venir a qualsevol classe. Quin dia et va bé?'])));
      return out;
    }
    var hs = huecosDia(L.dia);
    if (L.nivel === 'principiante' && !BOX.iniciacion.some(function (x) { return x[0] === L.dia; }) && !L.hora) {
      st.esperando = 'hora';
      out.push(T(cap(textoDia(L.dia)) + ' no hay Iniciación, pero puedes venir a una clase normal y el coach te lo adapta todo. ¿A qué hora te iría? Hay a las ' + hs.join(', ') + '.',
        cap(textoDia(L.dia)) + ' no hi ha Iniciació, però pots venir a una classe normal i el coach t\'ho adapta tot. A quina hora? Hi ha a les ' + hs.join(', ') + '.'));
      return out;
    }
    if (L.hora && /^(manana|mediodia|tarde|noche)$/.test(L.hora)) {
      var op = horaEnFranja(L.hora, L.dia);
      L.hora = '';
      if (op.length) {
        st.esperando = 'hora';
        var lista = op.join(', ').replace(/, ([^,]*)$/, T(' o a las $1', ' o a les $1'));
        out.push(T(cap(textoDia(L.dia)) + ' tienes a las ' + lista + '. ¿Cuál te va?', cap(textoDia(L.dia)) + ' tens a les ' + lista + '. Quina et va?'));
        return out;
      }
    }
    if (!L.hora) {
      if (L.nivel === 'principiante') {
        var ini = BOX.iniciacion.filter(function (x) { return x[0] === L.dia; })[0];
        if (ini) L.hora = ini[1];
      }
      if (!L.hora) {
        st.esperando = 'hora';
        out.push(una('hora', T(['¿A qué hora? ' + cap(textoDia(L.dia)) + ' hay clase a las ' + hs.join(', ') + '.', 'Perfecto. ' + cap(textoDia(L.dia)) + ' hay a las ' + hs.join(', ') + '. ¿Cuál te encaja?'],
          ['A quina hora? ' + cap(textoDia(L.dia)) + ' hi ha classe a les ' + hs.join(', ') + '.'])));
        return out;
      }
    }
    if (hs.indexOf(L.hora) === -1) {
      var pedida = L.hora; L.hora = '';
      st.esperando = 'hora';
      out.push(T('A las ' + pedida + ' no hay clase ' + textoDia(L.dia) + ' 🤔 Hay a las ' + hs.join(', ') + '. ¿Te va alguna?',
        'A les ' + pedida + ' no hi ha classe ' + textoDia(L.dia) + ' 🤔 Hi ha a les ' + hs.join(', ') + '. Et va bé alguna?'));
      return out;
    }
    if (!L.nombre) {
      st.esperando = 'nombre';
      out.push(una('nom', T(['Genial. ¿A nombre de quién lo apunto?', '¡Casi está! ¿Cómo te llamas? Así el coach sabe que vienes.'],
        ['Genial. A nom de qui ho apunto?'])));
      return out;
    }
    if (!st.preguntoLesion && !L.aviso) {
      st.preguntoLesion = true; st.esperando = 'lesion';
      out.push(una('les', T(['Una cosa antes, ' + nombreCorto() + ': ¿tienes alguna lesión o algo que deba saber el coach?', 'Y por último, ' + nombreCorto() + ', ¿alguna lesión o molestia que tengamos que tener en cuenta?'],
        ['Una cosa abans, ' + nombreCorto() + ': tens alguna lesió o alguna cosa que hagi de saber el coach?'])));
      return out;
    }
    return confirmar(out);
  }

  function confirmar(out) {
    var L = st.lead;
    L.clase = esIniciacion(L.dia, L.hora) ? 'Iniciación' : (L.nivel === 'principiante' ? 'Clase normal (adaptada)' : 'Clase normal');
    st.reservando = false; st.esperando = ''; st.pruebas = 1; L.estado = 'Prueba reservada';
    log('✅ <b>' + esc(L.nombre) + '</b> reserva clase de prueba: ' + textoDia(L.dia) + ' a las ' + L.hora + ' (' + L.clase + ')');
    toast('📲 Aviso a ' + BOX.coach + ': ' + L.nombre + ' viene a probar ' + textoDia(L.dia) + ' a las ' + L.hora);
    out.push(una('ok', T([
      '¡Listo, ' + nombreCorto() + '! 🙌 Te apunto ' + textoDia(L.dia) + ' a las ' + L.hora + (L.clase === 'Iniciación' ? ', a Iniciación con ' + BOX.coach : '') + '.',
      'Hecho ✅ ' + cap(textoDia(L.dia)) + ' a las ' + L.hora + ' te esperamos, ' + nombreCorto() + '.'
    ], ['Fet, ' + nombreCorto() + '! 🙌 T\'apunto ' + textoDia(L.dia) + ' a les ' + L.hora + '.'])));
    out.push(T('Ven 10 minutos antes con ropa cómoda, agua y zapatillas planas. Te escribo el día antes para recordártelo 👍',
      'Vine 10 minuts abans amb roba còmoda, aigua i bambes planes. T\'escric el dia abans per recordar-t\'ho 👍'));
    renderPanel();
    return out;
  }

  /* ---------- Cerebro ---------- */
  function responder(raw) {
    var t = norm(raw);
    if (RE.catalan.test(t)) st.ca = true;
    var L = st.lead, out = [], intents = [];

    // datos sueltos que pueden venir en cualquier mensaje
    var nombreAntes = L.nombre;
    var nom = sacarNombre(raw, t); if (nom) L.nombre = nom;
    if (has(t, RE.principiante)) L.nivel = 'principiante';
    else if (has(t, RE.experto)) L.nivel = 'con experiencia';

    // respuestas a lo que estábamos esperando
    if (st.esperando === 'nivel' && !L.nivel) {
      if (/^(si|sip|sii+|claro|un poco|alguna vez|bastante|algo|sí)\b/.test(t)) L.nivel = 'con experiencia';
      else if (RE.no.test(t)) L.nivel = 'principiante';
    }
    if (st.esperando === 'lesion') {
      if (has(t, RE.lesion) || (!RE.no.test(t) && t.length > 12)) {
        L.aviso = 'Lesión / molestia: «' + raw.slice(0, 70) + '»';
        log('⚠️ Avisar a ' + BOX.coach + ': ' + esc(raw.slice(0, 70)));
        out.push(una('lesok', T(['Gracias por decírmelo. Se lo paso a ' + BOX.coach + ' para que te adapte los ejercicios desde el primer día.', 'Apuntado. ' + BOX.coach + ' lo verá antes de la clase y te adapta lo que haga falta.'],
          ['Gràcies per dir-m\'ho. Li passo al ' + BOX.coach + ' perquè t\'adapti els exercicis des del primer dia.'])));
        st.esperando = '';
        return confirmar(out);
      }
      st.esperando = '';
      return confirmar([]);
    }
    var d = sacarDia(t), h = sacarHora(t), antes = [L.dia, L.hora, nombreAntes];
    if (d !== null && (st.reservando || has(t, RE.prueba))) { L.dia = d; }
    if (h && (st.reservando || has(t, RE.prueba) || d !== null)) { L.hora = h; }
    var acuse = '';
    if ((st.reservando || has(t, RE.prueba)) && !L.nivel) {
      var cuando = (L.dia !== antes[0] && L.dia !== null && huecosDia(L.dia).length ? textoDia(L.dia) : '') + (L.hora !== antes[1] && /^\d/.test(L.hora) ? T(' a las ', ' a les ') + L.hora : '');
      var nuevoNombre = L.nombre !== antes[2] && L.nombre;
      cuando = cuando.trim();
      if (cuando && nuevoNombre) acuse = T(una('acun', ['Perfecto, ' + nombreCorto() + '. ' + cap(cuando) + ', apuntado.', 'Encantado, ' + nombreCorto() + ' 🙂 Te guardo ' + cuando + '.']), 'Perfecte, ' + nombreCorto() + '. ' + cap(cuando) + ', apuntat.');
      else if (cuando) acuse = T(una('acu', ['Vale, ' + cuando + ' 👌', 'Perfecto, ' + cuando + ', apuntado.']), 'Val, ' + cuando + ' 👌');
      else if (nuevoNombre) acuse = T('Encantado, ' + nombreCorto() + ' 🙂', 'Encantat, ' + nombreCorto() + ' 🙂');
    }
    if (st.esperando === 'dia' && L.dia === null && /\b(primer|primero|el primero)\b/.test(t)) { L.dia = 1; L.hora = '19:00'; }
    if (st.esperando === 'dia' && L.dia === null && /\b(segund|el otro|el ultimo)\b/.test(t)) { L.dia = 3; L.hora = '20:00'; }

    // intenciones
    if (has(t, RE.bot)) intents.push('bot');
    if (has(t, RE.humano) && !has(t, RE.bot)) intents.push('humano');
    if (has(t, RE.lesion) && st.esperando !== 'lesion') intents.push('lesion');
    if (has(t, RE.ninos)) intents.push('ninos');
    if (has(t, RE.precio)) intents.push(has(t, RE.suelta) ? 'suelta' : 'precio');
    else if (has(t, RE.suelta)) intents.push('suelta');
    if (has(t, RE.hoy)) intents.push('hoy');
    else if (has(t, RE.horario) && !st.reservando && !has(t, RE.prueba)) intents.push('horario');
    if (has(t, RE.clase)) intents.push('clase');
    if (has(t, RE.objetivo)) intents.push('objetivo');
    if (has(t, RE.ubicacion)) intents.push('ubicacion');
    if (has(t, RE.material)) intents.push('material');
    if (has(t, RE.permanencia)) intents.push('permanencia');
    var kb = buscarKB(t).filter(function (e) {
      if (e.id === 'menu' && intents.length) return false;
      if (e.id === 'miedo' && intents.indexOf('lesion') !== -1) return false;
      return true;
    });
    var edad = t.match(/\btengo (\d{2}) (anos|any)/);
    if (edad && parseInt(edad[1], 10) >= 40 && !kb.some(function (e) { return e.id === 'edad'; })) kb.unshift(KB.filter(function (e) { return e.id === 'edad'; })[0]);
    var idsKB = kb.map(function (e) { return e.id; });
    if (idsKB.indexOf('festivos') !== -1) intents = intents.filter(function (i) { return i !== 'horario'; });
    if (idsKB.indexOf('quees') !== -1) intents = intents.filter(function (i) { return i !== 'clase'; });
    kb.slice(0, 2).forEach(function (e) { intents.push('kb:' + e.id); });
    var pidePrueba = has(t, RE.prueba) && !(idsKB.indexOf('app') !== -1 && !/(prueba|probar|apunt)/.test(t)) && !(edad && !/(prueba|probar|apunt|reserv)/.test(t));
    if (pidePrueba || (has(t, RE.principiante) && !intents.length)) intents.push('prueba');
    if (!intents.length && has(t, RE.gracias)) intents.push('gracias');
    if (!intents.length && has(t, RE.despedida)) intents.push('despedida');

    // saludo delante si toca
    var saluda = has(t, RE.saludo) && !st.saludado;
    st.saludado = st.saludado || saluda;

    // interés para el panel
    var mapa = { hoy: 'Clases de hoy', clase: 'Cómo es una clase', objetivo: 'Objetivo físico', precio: 'Precios', suelta: 'Clase suelta / bono', horario: 'Horarios', prueba: 'Clase de prueba', ninos: 'CrossFit Teens', lesion: 'Lesión', material: 'Qué traer', permanencia: 'Permanencia', ubicacion: 'Ubicación' };
    KB.forEach(function (e) { if (e.label) mapa['kb:' + e.id] = e.label; });
    intents.forEach(function (i) { if (mapa[i] && L.interes.indexOf(mapa[i]) === -1) { L.interes.push(mapa[i]); log('💬 Pregunta por ' + mapa[i].toLowerCase()); } });
    if (intents.length) st.dudas = 0;

    // si estábamos reservando y solo nos dan datos, seguimos el flujo
    var soloDatos = !intents.length || (intents.length === 1 && intents[0] === 'prueba');
    if (st.reservando && soloDatos) return siguientePasoReserva(acuse ? [acuse] : out);

    if (!intents.length) {
      if (saluda || (RE.si.test(t) && !st.reservando)) {
        if (saluda && nom) return [una('salnom', ['¡Hola, ' + nombreCorto() + '! 👋', '¡Buenas, ' + nombreCorto() + '!']), una('salnom2', ['Aquí Box Norte. ¿En qué te ayudo?', 'Cuéntame, ¿qué te gustaría saber del box?'])];
        if (saluda) return R.saludo();
        st.reservando = true; return siguientePasoReserva([]);
      }
      if (st.reservando) return siguientePasoReserva(acuse ? [acuse] : out);
      st.dudas = (st.dudas || 0) + 1;
      if (st.dudas > 1) {
        st.menu = true;
        return una('noent', [
          ['Igual no te he entendido bien 😅', '¿Me lo dices de otra forma?', 'Te puedo contar precios, horarios, actividades (CrossFit, Hyrox, halterofilia…) o reservarte una clase de prueba.'],
          ['Perdona, esa no la pillo.', 'Prueba a preguntármelo de otra manera, o dime si quieres saber precios, horarios o qué clases hay.']
        ]);
      }
      return R.desconocido(raw);
    }

    var conNombre = nom && saluda ? ', ' + nombreCorto() : '';
    var prefijo = saluda ? (st.ca ? una('prefca', ['Bon dia' + conNombre + '! ', 'Hola' + conNombre + '! ']) : (conNombre ? una('prefn', ['¡Hola' + conNombre + '! ', '¡Buenas' + conNombre + '! ']) : una('pref', ['¡Buenas! ', '¡Hola! ', 'Hola 👋 ']))) : '';
    intents.slice(0, 2).forEach(function (i) {
      var partes;
      if (i === 'prueba') { st.reservando = true; return; }
      if (i === 'lesion') {
        L.aviso = 'Lesión / molestia: «' + raw.slice(0, 70) + '»';
        log('⚠️ Menciona una lesión → aviso a ' + BOX.coach);
        partes = una('lesion', [
          ['Gracias por contármelo.', 'Con lesiones prefiero no aconsejarte yo: se lo paso a ' + BOX.coach + ', el head coach, y lo valora contigo antes de entrenar.', 'Mucha gente entrena con alguna molestia, se trata de adaptar los ejercicios.', 'Y si estás en tratamiento, coméntalo también con tu fisio.'],
          ['Eso mejor que lo vea ' + BOX.coach + ', que es quien adapta los entrenos.', 'Se lo paso ahora y te escribe él.', 'Tranqui, es más habitual de lo que parece y casi siempre se puede entrenar adaptando.']
        ]);
      } else if (i.indexOf('kb:') === 0) {
        var e = KB.filter(function (x) { return 'kb:' + x.id === i; })[0];
        partes = una('kb' + e.id, e.r);
        if (e.id === 'menu') st.menu = true;
      } else partes = R[i](raw);
      out = out.concat(partes);
    });
    if (prefijo && out.length) out[0] = prefijo + out[0];

    // la clase de prueba va al final, con su siguiente paso
    if (intents.indexOf('prueba') !== -1) {
      if (!out.length) out.push(prefijo + una('pr', T(['¡Claro! La primera clase es gratis y sin compromiso 🙌', '¡Genial que quieras probar! La primera clase es gratis.'],
        ['És clar! La primera classe és gratis i sense compromís 🙌'])));
      if (acuse) out.push(acuse);
      return siguientePasoReserva(out);
    }
    // si estaba a medias de reservar, recordatorio natural
    if (st.reservando && out.length < 3) {
      var r = siguientePasoReserva([]);
      if (r.length) {
        var q = r[r.length - 1].replace(/^[^¿?]*?[.!]\s+(?=¿)/, '').replace(/^¿(.)/, function (m, c) { return '¿' + c.toLowerCase(); });
        out.push(T('Y para la clase de prueba, ', 'I per a la classe de prova, ') + q);
      }
    } else if (intents.indexOf('precio') !== -1 && !st.lead.estado.match(/Prueba/) && out.length < 3) {
      // nada: el texto de precio ya invita a probar
    }
    return out;
  }

  /* ---------- Interfaz ---------- */
  var msgs, chips, statusEl, lastSide = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function bubble(text, side) {
    var b = document.createElement('div');
    b.className = 'dm-msg ' + side + (lastSide !== side ? ' first' : '');
    b.textContent = text;
    var t = document.createElement('span'); t.className = 'dm-t'; t.textContent = hora(); b.appendChild(t);
    msgs.appendChild(b); lastSide = side; msgs.scrollTop = msgs.scrollHeight;
  }
  function typing(on) {
    var el = document.getElementById('dm-typing');
    if (on && !el) { el = document.createElement('div'); el.id = 'dm-typing'; el.className = 'dm-typing'; el.innerHTML = '<i></i><i></i><i></i>'; msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight; }
    if (!on && el) el.remove();
    statusEl.textContent = on ? 'escribiendo…' : 'en línea';
  }
  function setChips(list) {
    chips.innerHTML = '';
    list.forEach(function (txt) { var c = document.createElement('button'); c.type = 'button'; c.textContent = txt; c.addEventListener('click', function () { enviar(txt); }); chips.appendChild(c); });
  }
  function chipsSegun() {
    var L = st.lead;
    if (st.esperando === 'nivel') return ['Nunca he hecho crossfit', 'Sí, vengo de otro box'];
    if (st.esperando === 'dia') return L.nivel === 'principiante' ? ['El martes a las 19:00', 'El jueves a las 20:00'] : ['Mañana por la tarde', 'El lunes a las 19h', 'El sábado'];
    if (st.esperando === 'hora') return ['Por la tarde', 'A las 19h', 'A primera hora'];
    if (st.esperando === 'nombre') return ['Me llamo Laura'];
    if (st.esperando === 'lesion') return ['No, ninguna', 'Me molesta un poco la espalda'];
    if (st.menu) { st.menu = false; return ['¿Qué actividades hay?', '¿Cuánto cuesta?', '¿Cómo es una clase?', 'Quiero probar una clase']; }
    if (L.estado === 'Prueba reservada') return ['¿Qué tengo que traer?', '¿Hay duchas?', '¿Cuánto cuesta al mes?', 'Gracias!'];
    return ['¿Qué actividades hay?', '¿Cuánto cuesta al mes?', '¿Hacéis Hyrox?', 'Quiero probar una clase'];
  }
  function log(html) {
    var l = $('#dm-log'), e = l.querySelector('.dm-empty'); if (e) e.remove();
    var li = document.createElement('li'); li.innerHTML = '<time>' + hora() + '</time><span>' + html + '</span>'; l.insertBefore(li, l.firstChild);
  }
  function toast(txt) {
    var t = $('#dm-toast'); if (!t) return;
    t.textContent = txt; t.hidden = false; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 5200);
  }
  function renderPanel() {
    var L = st.lead;
    $('#dm-k1').textContent = st.consultas;
    var media = st.tiempos.length ? st.tiempos.reduce(function (a, b) { return a + b; }, 0) / st.tiempos.length : 0;
    $('#dm-k2').textContent = st.tiempos.length ? media.toFixed(1).replace('.', ',') + ' s' : '—';
    $('#dm-k3').textContent = st.pruebas;
    $('#dm-name').textContent = L.nombre || '—';
    $('#dm-int').textContent = L.interes.length ? L.interes.join(', ') : '—';
    $('#dm-lvl').textContent = L.nivel ? cap(L.nivel) : '—';
    $('#dm-class').textContent = L.estado === 'Prueba reservada' ? (L.dia !== null ? cap(textoDia(L.dia)) + ' · ' + L.hora + ' · ' + L.clase : L.clase) : '—';
    $('#dm-alert').textContent = L.aviso || '—';
    $('#dm-alert').classList.toggle('warn', !!L.aviso);
    var pill = $('#dm-state');
    pill.textContent = L.estado;
    pill.className = 'dm-pill' + (L.estado === 'Prueba reservada' ? ' ok' : L.estado === 'Necesita a una persona' ? ' warn' : '');
  }

  async function enviar(texto) {
    texto = (texto || '').trim();
    if (!texto || st.busy) return;
    var intro = document.getElementById('dm-intro'); if (intro) intro.remove();
    bubble(texto, 'out');
    st.consultas++; st.historial.push({ role: 'user', content: texto });
    if (st.lead.estado === 'Nuevo') st.lead.estado = 'Interesado';
    st.busy = true; chips.innerHTML = ''; $('#dm-send').disabled = true;
    var t0 = Date.now(), partes;
    await wait(500); typing(true);
    try {
      partes = pulir(responder(texto));
    } catch (e) {
      partes = pulir(R.desconocido(texto));
    }
    st.tiempos.push(Math.max(1, (Date.now() - t0) / 1000 + 0.4));
    renderPanel();
    for (var i = 0; i < partes.length; i++) {
      var pausa = Math.min(550 + partes[i].length * 20, 2300) - (i === 0 ? (Date.now() - t0) : 0);
      typing(true); if (pausa > 0) await wait(pausa);
      typing(false); bubble(partes[i], 'in');
      if (i < partes.length - 1) await wait(250 + Math.random() * 350);
    }
    st.historial.push({ role: 'assistant', content: partes.join('\n\n') });
    statusEl.textContent = 'en línea';
    st.busy = false; $('#dm-send').disabled = false;
    setChips(chipsSegun());
    renderPanel();
  }

  function iniciar() {
    reset(); lastSide = null; usados = {};
    msgs.innerHTML = '<div class="dm-day">Hoy</div><div class="dm-note" id="dm-intro">Escribe como si fueras alguien que quiere empezar a entrenar. Pregunta lo que quieras: precios, horarios, si puedes ir sin experiencia, una lesión… o pide una clase de prueba.</div>';
    $('#dm-log').innerHTML = '<li class="dm-empty">Aún no hay actividad. Escribe en el chat.</li>';
    statusEl.textContent = 'en línea';
    setChips(['Hola! Nunca he hecho crossfit, ¿puedo probar?', '¿Cuánto cuesta al mes?', 'Tengo una lesión de rodilla', '¿Eres un bot?']);
    renderPanel();
  }

  document.addEventListener('DOMContentLoaded', function () {
    msgs = $('#dm-msgs'); chips = $('#dm-chips'); statusEl = $('#dm-status');
    if (!msgs) return;
    var box = $('#dm-q');
    $('#dm-form').addEventListener('submit', function (e) { e.preventDefault(); var v = box.value; box.value = ''; enviar(v); });
    $('#dm-reset').addEventListener('click', iniciar);
    iniciar();
  });

  // para pruebas automáticas
  window.__demoResponder = function (t) { return pulir(responder(t)); };
  window.__demoReset = function () { reset(); };
  window.__demoState = function () { return st; };
})();
