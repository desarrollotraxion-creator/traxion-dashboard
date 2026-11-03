/**
 * ============================================================================
 * CONTENEDOR CENTRAL DE DATOS TRAXIÓN (GITHUB REPO + INDEXEDDB MULTIMÓDULO)
 * Norma Técnica: TSE-09-SIGEO-PR
 * Idioma: 100% Español
 * ============================================================================
 * Utiliza el propio repositorio de GitHub (desarrollotraxion-creator/traxion-dashboard,
 * carpeta /datos_compartidos) + IndexedDB de alta capacidad como contenedor central
 * para compartir las 6 familias de archivos entre todas las computadoras y módulos.
 */

(function (global) {
  'use strict';

  const GITHUB_CONFIG = (function () {
    let user = "desarrollotraxion-creator";
    let repo = "portal_Traxion";
    try {
      const host = (global.location && global.location.hostname) || "";
      const path = (global.location && global.location.pathname) || "";
      if (host.endsWith(".github.io")) {
        user = host.replace(".github.io", "");
        const partes = path.split("/").filter(Boolean);
        if (partes.length > 0 && !partes[0].endsWith(".html")) {
          repo = partes[0];
        }
      }
    } catch (e) {}
    return {
      user: user,
      repo: repo,
      branch: "main",
      folder: "datos_compartidos"
    };
  })();

  const STORAGE_KEY_GH_TOKEN = "TRAXION_GITHUB_PAT_TOKEN";
  const DB_NAME = "TraxionContenedorCentralDB";
  const DB_VERSION = 2;
  const STORE_NAME = "archivos_compartidos";
  const CANAL_BROADCAST = "traxion_contenedor_canal";

  // Catálogo oficial de las familias de archivos compartidos
  const FAMILIAS_ARCHIVOS = {
    existencias: {
      clave: "existencias",
      propData: "existenciasData",
      nombre: "Existencias Físicas WMS (Izel)",
      descripcion: "Stock físico por ubicación, área, lote, caducidad y LPN",
      modulos: ["MODULO 1 SAM21", "SURTIMIENTO", "Semáforo FG", "Sobrellenado", "Balance SAP vs WMS", "BALANCE 2"]
    },
    recoleccion: {
      clave: "recoleccion",
      propData: "recoleccionData",
      nombre: "Lista de Recolección (Viajes)",
      descripcion: "Demanda de cajas, pallets y SKUs por viaje/shipment",
      modulos: ["MODULO 1 SAM21", "SURTIMIENTO", "Semáforo FG (PEPS)"]
    },
    hcarga: {
      clave: "hcarga",
      propData: "hcargaData",
      nombre: "Avance H.CARGA (WMS)",
      descripcion: "Avance de cajas picadas, restos, estatus y bahías por viaje",
      modulos: ["MODULO 1 SAM21", "Semáforo de Embarques"]
    },
    sap: {
      clave: "sap",
      propData: "sapData",
      nombre: "Reporte SAP Rector / Interbodegas",
      descripcion: "Stock contable SAP por planta (MX32, MX21, MX20, MX33) y estatus",
      modulos: ["Balance SAP vs WMS", "BALANCE 2", "Stock Interbodegas"]
    },
    movimientos_wms: {
      clave: "movimientos_wms",
      propData: "movimientosWmsData",
      nombre: "Log de Movimientos WMS (izelcetus)",
      descripcion: "Historial de transacciones, ingresos, surtido dirigido y verificación",
      modulos: ["Sistema de Sobrellenado", "Productividad Operativa"]
    },
    maestro_materiales: {
      clave: "maestro_materiales",
      propData: "maestroMaterialesData",
      nombre: "Catálogo Maestro de Materiales",
      descripcion: "Estándar de cajas por pallet, descripción y costos unitarios por SKU",
      modulos: ["MODULO 1 SAM21", "Balance SAP vs WMS"]
    },
    reglas_pick_bulk: {
      clave: "reglas_pick_bulk",
      propData: "reglasPickBulkData",
      nombre: "Reglas de Ubicaciones Pick / Bulk",
      descripcion: "Asignación maestra de ubicaciones de Picking (P) y Bulk (BP)",
      modulos: ["SURTIMIENTO"]
    },
    reglas_estiba: {
      clave: "reglas_estiba",
      propData: "reglasEstibaData",
      nombre: "Reglas de Estiba y Fondeo",
      descripcion: "Límites de estiba máxima y ubicaciones de fondeo autorizadas",
      modulos: ["Sistema de Sobrellenado"]
    }
  };

  // Inicializar estructura global en ventana actual
  if (!global.DATOS_COMPARTIDOS) {
    global.DATOS_COMPARTIDOS = {
      existenciasData: null,
      recoleccionData: null,
      hcargaData: null,
      sapData: null,
      movimientosWmsData: null,
      maestroMaterialesData: null,
      reglasPickBulkData: null,
      reglasEstibaData: null,
      nombresArchivos: {},
      ultimaActualizacion: null,
      origenActualizacion: null,
      listo: false
    };
  }

  const suscriptores = [];
  let timerDebounceSuscriptores = null;
  let ultimaHuellaSuscriptores = "";

  let canalBC = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      canalBC = new BroadcastChannel(CANAL_BROADCAST);
      canalBC.onmessage = function (ev) {
        if (ev.data && ev.data.tipo === "TRAXION_SYNC_UPDATE") {
          aplicarDatosEnMemoria(ev.data.payload, false);
          ejecutarSuscriptores(ev.data.claveActualizada);
        } else if (ev.data && ev.data.tipo === "TRAXION_SYNC_CLEAR") {
          vaciarMemoriaLocal();
          ejecutarSuscriptores("LIMPIEZA");
        }
      };
    }
  } catch (e) {}

  // Escuchar mensajes postMessage entre iframe y ventana padre
  global.addEventListener("message", function (ev) {
    const msg = ev.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.accion === "TRAXION_PUSH_DATOS_A_HIJO" && msg.datos) {
      aplicarDatosEnMemoria(msg.datos, false);
      ejecutarSuscriptores(msg.claveActualizada || null);
    } else if (msg.accion === "TRAXION_HIJO_SUBIO_ARCHIVO" && msg.clave && msg.matriz) {
      const infoFam = FAMILIAS_ARCHIVOS[msg.clave];
      if (infoFam) {
        global.DATOS_COMPARTIDOS[infoFam.propData] = msg.matriz;
        if (!global.DATOS_COMPARTIDOS.nombresArchivos) global.DATOS_COMPARTIDOS.nombresArchivos = {};
        global.DATOS_COMPARTIDOS.nombresArchivos[msg.clave] = msg.nombreArchivo || infoFam.nombre;
        global.DATOS_COMPARTIDOS.ultimaActualizacion = msg.timestamp || new Date().toLocaleTimeString("es-MX");
        global.DATOS_COMPARTIDOS.origenActualizacion = msg.origen || "Módulo Operativo";
        global.DATOS_COMPARTIDOS.listo = true;

        guardarEnIndexedDB(msg.clave, msg.matriz, msg.nombreArchivo, global.DATOS_COMPARTIDOS.ultimaActualizacion, msg.origen);

        if (typeof global.actualizarBadgeEstado === "function") {
          global.actualizarBadgeEstado(true, `GitHub/Local Sync (${global.DATOS_COMPARTIDOS.ultimaActualizacion})`);
        }
        if (typeof global.actualizarTarjetasEstadoHub === "function") {
          global.actualizarTarjetasEstadoHub();
        }
      }
    } else if (msg.accion === "TRAXION_SOLICITAR_DATOS_AL_PADRE") {
      if (global.DATOS_COMPARTIDOS && global.DATOS_COMPARTIDOS.listo && ev.source) {
        try {
          ev.source.postMessage({
            accion: "TRAXION_PUSH_DATOS_A_HIJO",
            datos: serializarDatosCompartidos()
          }, "*");
        } catch (err) {}
      }
    }
  });

  // ==========================================================================
  // GESTIÓN DE TOKEN DE GITHUB (PARA ESCRITURA DIRECTA DESDE EL NAVEGADOR)
  // ==========================================================================
  function obtenerTokenGitHub() {
    try {
      return (global.localStorage && global.localStorage.getItem(STORAGE_KEY_GH_TOKEN)) || "";
    } catch (e) {
      return "";
    }
  }

  function guardarTokenGitHub(token) {
    try {
      if (!global.localStorage) return false;
      const limpio = String(token || "").trim();
      if (limpio) {
        global.localStorage.setItem(STORAGE_KEY_GH_TOKEN, limpio);
      } else {
        global.localStorage.removeItem(STORAGE_KEY_GH_TOKEN);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function construirHeadersGitHub() {
    const headers = {
      "Accept": "application/vnd.github+json"
    };
    const token = obtenerTokenGitHub();
    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }
    return headers;
  }

  // ==========================================================================
  // CAPA INDEXEDDB (CONTENEDOR DE ALTA CAPACIDAD EN EL NAVEGADOR)
  // ==========================================================================
  function abrirDB() {
    return new Promise(function (resolve) {
      if (!global.indexedDB) {
        resolve(null);
        return;
      }
      try {
        const req = global.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "clave" });
          }
        };
        req.onsuccess = function (e) {
          resolve(e.target.result);
        };
        req.onerror = function () {
          resolve(null);
        };
      } catch (err) {
        resolve(null);
      }
    });
  }

  async function guardarEnIndexedDB(clave, matriz, nombreArchivo, timestamp, origen) {
    const db = await abrirDB();
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put({
          clave: clave,
          matriz: matriz,
          nombreArchivo: nombreArchivo || clave,
          timestamp: timestamp || new Date().toLocaleTimeString("es-MX"),
          origen: origen || "Contenedor Central",
          filas: Array.isArray(matriz) ? matriz.length : 0,
          fechaMs: Date.now()
        });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function leerTodoDeIndexedDB() {
    const db = await abrirDB();
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = function () {
          resolve(req.result || []);
        };
        req.onerror = function () {
          resolve(null);
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function limpiarIndexedDB() {
    const db = await abrirDB();
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) {
        resolve(false);
      }
    });
  }

  function vaciarMemoriaLocal() {
    const dc = global.DATOS_COMPARTIDOS;
    for (const clave in FAMILIAS_ARCHIVOS) {
      dc[FAMILIAS_ARCHIVOS[clave].propData] = null;
    }
    dc.nombresArchivos = {};
    dc.ultimaActualizacion = null;
    dc.origenActualizacion = null;
    dc.listo = false;
    ultimaHuellaSuscriptores = "";
  }

  // ==========================================================================
  // GESTIÓN DE MEMORIA Y SINCRONIZACIÓN ENTRE VENTANAS
  // ==========================================================================
  function serializarDatosCompartidos() {
    const dc = global.DATOS_COMPARTIDOS;
    return {
      existencias: dc.existenciasData,
      recoleccion: dc.recoleccionData,
      hcarga: dc.hcargaData,
      sap: dc.sapData,
      movimientos_wms: dc.movimientosWmsData,
      maestro_materiales: dc.maestroMaterialesData,
      reglas_pick_bulk: dc.reglasPickBulkData,
      reglas_estiba: dc.reglasEstibaData,
      nombresArchivos: dc.nombresArchivos || {},
      ultimaActualizacion: dc.ultimaActualizacion,
      origenActualizacion: dc.origenActualizacion
    };
  }

  function aplicarDatosEnMemoria(datos, guardarLocal) {
    if (!datos) return false;
    let huboCambios = false;
    const dc = global.DATOS_COMPARTIDOS;

    for (const clave in FAMILIAS_ARCHIVOS) {
      const info = FAMILIAS_ARCHIVOS[clave];
      const matrizEntrante = datos[clave] || datos[info.propData];
      if (Array.isArray(matrizEntrante) && matrizEntrante.length > 0) {
        dc[info.propData] = matrizEntrante;
        huboCambios = true;
        if (guardarLocal) {
          const nom = (datos.nombresArchivos && datos.nombresArchivos[clave]) || info.nombre;
          guardarEnIndexedDB(clave, matrizEntrante, nom, datos.timestamp || datos.ultimaActualizacion, datos.origen || datos.origenActualizacion);
        }
      }
    }

    if (datos.nombresArchivos) {
      dc.nombresArchivos = Object.assign({}, dc.nombresArchivos || {}, datos.nombresArchivos);
    }
    if (datos.timestamp || datos.ultimaActualizacion) {
      dc.ultimaActualizacion = datos.timestamp || datos.ultimaActualizacion;
    }
    if (datos.origen || datos.origenActualizacion) {
      dc.origenActualizacion = datos.origen || datos.origenActualizacion;
    }
    if (huboCambios) {
      dc.listo = true;
    }
    return huboCambios;
  }

  function intentarLeerDesdePadreDirecto() {
    try {
      if (global.parent && global.parent !== global && typeof global.parent.obtenerDatosWMS === "function") {
        const datosPadre = global.parent.obtenerDatosWMS();
        if (datosPadre && datosPadre.listo) {
          aplicarDatosEnMemoria(datosPadre, false);
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  // ==========================================================================
  // AUTO-DETECTOR INTELIGENTE DE FAMILIA DE ARCHIVO (POR NOMBRE Y COLUMNAS)
  // ==========================================================================
  function detectarFamiliaDeArchivo(nombreArchivo, matriz) {
    const n = String(nombreArchivo || "").toLowerCase();

    if (n.includes("hcarga") || n.includes("h.carga") || n.includes("h_carga")) return "hcarga";
    if (n.includes("recol") || n.includes("viaje")) return "recoleccion";
    if (n.includes("izelcetus") || n.includes("movimiento") || n.includes("bitacora") || n.includes("movimientos_wms")) return "movimientos_wms";
    if (n.includes("sap") || n.includes("mb52") || n.includes("interbodega") || n.includes("rector")) return "sap";
    if (n.includes("estiba") || n.includes("fondeo") || n.includes("reglas_estiba")) return "reglas_estiba";
    if ((n.includes("regla") && (n.includes("pick") || n.includes("bulk"))) || n.includes("reglas_pick_bulk")) return "reglas_pick_bulk";
    if (n.includes("cat_materiales") || n.includes("catalogo") || n.includes("maestro") || n.includes("sistema gio")) return "maestro_materiales";
    if (n.includes("existencia") || n.includes("inventario") || n.includes("stock") || n.includes("fisico") || n.includes("izel")) return "existencias";

    if (Array.isArray(matriz) && matriz.length > 1) {
      const fila0 = (matriz[0] || []).map(function (c) { return String(c || "").toLowerCase().trim(); });
      const fila1 = (matriz[1] || []).map(function (c) { return String(c || "").toUpperCase().trim(); });
      const numCols = Math.max(fila0.length, fila1.length);

      if (numCols >= 40) return "hcarga";
      if (numCols >= 30 && numCols <= 39) return "movimientos_wms";

      if (fila0.some(function (h) { return h.includes("storage location") || h.includes("bum quantity") || h.includes("focus factory") || h === "plant"; })) {
        return "sap";
      }

      if (
        fila0.some(function (h) { return h.includes("ubicacion") || h.includes("ubicación") || h.includes("lpn"); }) ||
        ["PICK", "BULK", "BULKPK", "RACKS", "NARANJA", "ZONAQI", "DAÑOS", "STAGE"].includes(fila1[6] || "")
      ) {
        return "existencias";
      }

      if (numCols >= 10 && numCols <= 15 && /^\d{6,12}$/.test(String(fila1[9] || "").replace(/\|/g, ""))) {
        return "recoleccion";
      }
    }

    return "existencias";
  }

  // ==========================================================================
  // CONVERSORES UNIVERSALES DE FORMATO (MATRIZ <-> CSV <-> OBJETOS JSON)
  // ==========================================================================
  function matrizACsv(matriz) {
    if (!Array.isArray(matriz) || matriz.length === 0) return "";
    const lineas = new Array(matriz.length);
    for (let i = 0; i < matriz.length; i++) {
      const fila = matriz[i];
      if (!Array.isArray(fila)) {
        lineas[i] = "";
        continue;
      }
      const celdas = new Array(fila.length);
      for (let j = 0; j < fila.length; j++) {
        const val = fila[j] === null || fila[j] === undefined ? "" : String(fila[j]);
        if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
          celdas[j] = '"' + val.replace(/"/g, '""') + '"';
        } else {
          celdas[j] = val;
        }
      }
      lineas[i] = celdas.join(",");
    }
    return lineas.join("\n");
  }

  function csvAMatriz(textoCsv) {
    if (!textoCsv || typeof textoCsv !== "string") return [];
    if (global.Papa && typeof global.Papa.parse === "function") {
      const res = global.Papa.parse(textoCsv.trim(), { skipEmptyLines: true });
      return (res.data || []).map(function (f) {
        return Array.isArray(f) ? f.map(function (c) { return String(c ?? "").trim(); }) : [];
      });
    }
    const lineas = textoCsv.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    return lineas.map(function (linea) {
      const resultado = [];
      let actual = "";
      let enComillas = false;
      for (let i = 0; i < linea.length; i++) {
        const ch = linea[i];
        if (ch === '"') {
          if (enComillas && linea[i + 1] === '"') {
            actual += '"';
            i++;
          } else {
            enComillas = !enComillas;
          }
        } else if (ch === "," && !enComillas) {
          resultado.push(actual.trim());
          actual = "";
        } else {
          actual += ch;
        }
      }
      resultado.push(actual.trim());
      return resultado;
    });
  }

  function matrizAObjetos(matriz) {
    if (!Array.isArray(matriz) || matriz.length < 2) return [];

    let idxHeader = 0;
    for (let i = 0; i < Math.min(10, matriz.length); i++) {
      const noVacios = (matriz[i] || []).filter(function (c) { return String(c || "").trim() !== ""; }).length;
      if (noVacios >= 2) {
        idxHeader = i;
        break;
      }
    }

    const headers = (matriz[idxHeader] || []).map(function (h, idx) {
      const limpio = String(h ?? "").trim();
      return limpio !== "" ? limpio : "__EMPTY_" + idx;
    });

    const objetos = [];
    for (let r = idxHeader + 1; r < matriz.length; r++) {
      const fila = matriz[r];
      if (!Array.isArray(fila)) continue;

      let tieneDatos = false;
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        const val = fila[c] !== undefined && fila[c] !== null ? String(fila[c]).trim() : "";
        if (val !== "") tieneDatos = true;
        obj[headers[c]] = val;
      }
      if (tieneDatos) {
        objetos.push(obj);
      }
    }
    return objetos;
  }

  function objetosAMatriz(objetos) {
    if (!Array.isArray(objetos) || objetos.length === 0) return [];
    const headersSet = new Set();
    objetos.forEach(function (obj) {
      if (obj && typeof obj === "object") {
        Object.keys(obj).forEach(function (k) { headersSet.add(k); });
      }
    });
    const headers = Array.from(headersSet);
    const matriz = [headers];
    objetos.forEach(function (obj) {
      matriz.push(headers.map(function (h) {
        return obj[h] !== undefined && obj[h] !== null ? String(obj[h]).trim() : "";
      }));
    });
    return matriz;
  }

  function archivoAMatriz(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error("No se proporcionó ningún archivo."));
        return;
      }

      const nombre = (file.name || "").toLowerCase();
      const reader = new FileReader();

      if (global.XLSX) {
        reader.onload = function (e) {
          try {
            const workbook = global.XLSX.read(e.target.result, {
              type: "binary",
              raw: false,
              cellText: true,
              codepage: 65001
            });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const matrix = global.XLSX.utils.sheet_to_json(firstSheet, {
              header: 1,
              defval: "",
              raw: false
            });
            const matrixPura = matrix.map(function (fila) {
              return (fila || []).map(function (celda) { return String(celda ?? "").trim(); });
            });
            resolve(matrixPura);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = reject;
        reader.readAsBinaryString(file);
      } else if (nombre.endsWith(".csv") || nombre.endsWith(".txt")) {
        reader.onload = function (e) {
          try {
            resolve(csvAMatriz(e.target.result));
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = reject;
        reader.readAsText(file, "UTF-8");
      } else {
        reject(new Error("Librería XLSX no disponible para leer archivo Excel."));
      }
    });
  }

  // ==========================================================================
  // NOTIFICACIONES VISUALES (TOAST INSTITUCIONAL TRAXIÓN)
  // ==========================================================================
  function mostrarNotificacionSync(mensaje, tipo) {
    try {
      if (!global.document || !global.document.body) return;
      let toast = global.document.getElementById("traxion-sync-toast");
      if (!toast) {
        toast = global.document.createElement("div");
        toast.id = "traxion-sync-toast";
        toast.style.cssText = [
          "position:fixed",
          "bottom:18px",
          "right:18px",
          "z-index:99999",
          "padding:10px 16px",
          "border-radius:8px",
          "font-family:Inter,Montserrat,system-ui,sans-serif",
          "font-size:12px",
          "font-weight:700",
          "color:#FFFFFF",
          "box-shadow:0 8px 20px rgba(15,23,42,0.25)",
          "display:flex",
          "align-items:center",
          "gap:8px",
          "transition:opacity 0.3s ease, transform 0.3s ease",
          "opacity:0",
          "transform:translateY(10px)",
          "pointer-events:none"
        ].join(";");
        global.document.body.appendChild(toast);
      }

      if (tipo === "error") {
        toast.style.background = "#D92D20";
        toast.style.borderLeft = "4px solid #FCA5A5";
      } else if (tipo === "cargando") {
        toast.style.background = "#182237";
        toast.style.borderLeft = "4px solid #C0D838";
      } else {
        toast.style.background = "#037A48";
        toast.style.borderLeft = "4px solid #A7F3D0";
      }

      toast.innerHTML = "<span>" + mensaje + "</span>";
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";

      if (toast._timer) clearTimeout(toast._timer);
      toast._timer = setTimeout(function () {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
      }, 4200);
    } catch (e) {}
  }

  // ==========================================================================
  // CONTENEDOR EN GITHUB (SUBIDA CON GIT DATA API HASTA 100 MB + LECTURA RAW)
  // ==========================================================================

  /**
   * Sube uno o varios archivos al contenedor /datos_compartidos del repositorio de GitHub
   * usando la API de Git Blobs/Trees/Commits (soporta archivos pesados de hasta 100 MB).
   */
  async function subirLoteAGitHub(mapaArchivosSubir) {
    const token = obtenerTokenGitHub();
    if (!token) {
      return { exito: false, motivo: "SIN_TOKEN" };
    }

    const baseApi = `https://api.github.com/repos/${GITHUB_CONFIG.user}/${GITHUB_CONFIG.repo}`;
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    };

    try {
      // 1. Obtener el último commit de la rama principal
      const refRes = await fetch(`${baseApi}/git/ref/heads/${GITHUB_CONFIG.branch}`, { headers: headers });
      if (!refRes.ok) {
        throw new Error(`No se pudo leer la rama ${GITHUB_CONFIG.branch} en GitHub (${refRes.status}). Verifica tu Token.`);
      }
      const refData = await refRes.json();
      const latestCommitSha = refData.object.sha;

      // 2. Obtener el árbol base del último commit
      const commitRes = await fetch(`${baseApi}/git/commits/${latestCommitSha}`, { headers: headers });
      const commitData = await commitRes.json();
      const baseTreeSha = commitData.tree.sha;

      // 3. Crear un Blob en GitHub por cada familia actualizada
      const treeItems = [];
      const ahora = new Date().toLocaleString("es-MX");

      for (const clave in mapaArchivosSubir) {
        const item = mapaArchivosSubir[clave];
        if (!item || !Array.isArray(item.matriz) || item.matriz.length === 0) continue;

        const contenidoJson = JSON.stringify({
          clave: clave,
          nombreArchivo: item.nombreArchivo || clave,
          timestamp: ahora,
          origen: item.origen || "Portal Traxión",
          filas: item.matriz.length,
          matriz: item.matriz
        });

        const blobRes = await fetch(`${baseApi}/git/blobs`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            content: contenidoJson,
            encoding: "utf-8"
          })
        });

        if (!blobRes.ok) {
          throw new Error(`Error al crear Blob en GitHub para ${clave} (${blobRes.status})`);
        }
        const blobData = await blobRes.json();

        treeItems.push({
          path: `${GITHUB_CONFIG.folder}/${clave}.json`,
          mode: "100644",
          type: "blob",
          sha: blobData.sha
        });
      }

      if (treeItems.length === 0) {
        return { exito: true, subidos: 0 };
      }

      // 4. Crear el nuevo árbol en GitHub
      const newTreeRes = await fetch(`${baseApi}/git/trees`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems
        })
      });
      if (!newTreeRes.ok) {
        throw new Error(`Error al actualizar árbol de archivos en GitHub (${newTreeRes.status})`);
      }
      const newTreeData = await newTreeRes.json();

      // 5. Crear el commit
      const nombresClaves = Object.keys(mapaArchivosSubir).join(", ");
      const newCommitRes = await fetch(`${baseApi}/git/commits`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          message: `🔄 Actualización de datos operativos (${nombresClaves}) - Portal Traxión`,
          tree: newTreeData.sha,
          parents: [latestCommitSha]
        })
      });
      if (!newCommitRes.ok) {
        throw new Error(`Error al confirmar cambios en GitHub (${newCommitRes.status})`);
      }
      const newCommitData = await newCommitRes.json();

      // 6. Actualizar la referencia de la rama
      const updateRefRes = await fetch(`${baseApi}/git/refs/heads/${GITHUB_CONFIG.branch}`, {
        method: "PATCH",
        headers: headers,
        body: JSON.stringify({
          sha: newCommitData.sha,
          force: false
        })
      });
      if (!updateRefRes.ok) {
        throw new Error(`Error al publicar rama en GitHub (${updateRefRes.status})`);
      }

      return { exito: true, subidos: treeItems.length, timestamp: ahora };
    } catch (err) {
      console.error("Error al subir al contenedor de GitHub:", err);
      return { exito: false, motivo: err.message };
    }
  }

  /**
   * Descarga todos los archivos disponibles en la carpeta /datos_compartidos del repositorio de GitHub.
   * Soporta tanto los archivos .json generados por el portal como archivos .csv / .xlsx subidos directo al repo.
   */
  async function descargarDesdeGitHub(silencioso) {
    if (!silencioso) {
      mostrarNotificacionSync("🐙 Sincronizando desde el contenedor de GitHub (/datos_compartidos)...", "cargando");
    }

    const rutasCandidatas = [
      GITHUB_CONFIG.folder,
      "portal-traxion/" + GITHUB_CONFIG.folder,
      "portal_traxion/" + GITHUB_CONFIG.folder
    ];

    try {
      let res = null;
      for (let rIdx = 0; rIdx < rutasCandidatas.length; rIdx++) {
        const rutaPrueba = rutasCandidatas[rIdx];
        const urlCarpeta = `https://api.github.com/repos/${GITHUB_CONFIG.user}/${GITHUB_CONFIG.repo}/contents/${rutaPrueba}?ref=${GITHUB_CONFIG.branch}&t=${Date.now()}`;
        const intento = await fetch(urlCarpeta, { headers: construirHeadersGitHub() });
        if (intento.ok) {
          res = intento;
          GITHUB_CONFIG.folder = rutaPrueba;
          break;
        }
        if (rIdx === 0) res = intento;
      }

      if (!res || res.status === 404) {
        // La carpeta /datos_compartidos aún no existe en el repo; usar datos locales de IndexedDB
        if (!silencioso) {
          mostrarNotificacionSync("ℹ️ Listo en Contenedor Local. Puedes subir archivos a /datos_compartidos en GitHub.", "cargando");
        }
        return global.DATOS_COMPARTIDOS;
      }
      if (!res.ok) {
        throw new Error(`GitHub API respondió con estado ${res.status}`);
      }

      const listaArchivos = await res.json();
      if (!Array.isArray(listaArchivos) || listaArchivos.length === 0) {
        return global.DATOS_COMPARTIDOS;
      }

      let archivosCargados = 0;
      const ahora = new Date().toLocaleTimeString("es-MX");

      for (let i = 0; i < listaArchivos.length; i++) {
        const item = listaArchivos[i];
        if (!item || item.type !== "file") continue;

        const nombreLower = item.name.toLowerCase();
        const rawUrl = item.download_url || `https://raw.githubusercontent.com/${GITHUB_CONFIG.user}/${GITHUB_CONFIG.repo}/${GITHUB_CONFIG.branch}/${item.path}?t=${Date.now()}`;

        try {
          if (nombreLower.endsWith(".json")) {
            const rJson = await fetch(rawUrl);
            if (!rJson.ok) continue;
            const contenido = await rJson.json();

            // Puede ser un archivo individual { clave, matriz, nombreArchivo } o un paquete completo
            if (contenido && Array.isArray(contenido.matriz) && contenido.matriz.length > 0) {
              const clave = contenido.clave || detectarFamiliaDeArchivo(item.name, contenido.matriz);
              const info = FAMILIAS_ARCHIVOS[clave];
              if (info) {
                global.DATOS_COMPARTIDOS[info.propData] = contenido.matriz;
                global.DATOS_COMPARTIDOS.nombresArchivos[clave] = contenido.nombreArchivo || item.name;
                global.DATOS_COMPARTIDOS.ultimaActualizacion = contenido.timestamp || ahora;
                global.DATOS_COMPARTIDOS.origenActualizacion = "GitHub Repo";
                global.DATOS_COMPARTIDOS.listo = true;
                await guardarEnIndexedDB(clave, contenido.matriz, contenido.nombreArchivo || item.name, contenido.timestamp || ahora, "GitHub Repo");
                archivosCargados++;
              }
            } else if (contenido && contenido.datos) {
              if (aplicarDatosEnMemoria(contenido.datos, true)) {
                archivosCargados++;
              }
            }
          } else if (nombreLower.endsWith(".csv") || nombreLower.endsWith(".txt")) {
            const rTxt = await fetch(rawUrl);
            if (!rTxt.ok) continue;
            const texto = await rTxt.text();
            const matriz = csvAMatriz(texto);
            if (matriz.length > 0) {
              const clave = detectarFamiliaDeArchivo(item.name, matriz);
              const info = FAMILIAS_ARCHIVOS[clave];
              if (info) {
                global.DATOS_COMPARTIDOS[info.propData] = matriz;
                global.DATOS_COMPARTIDOS.nombresArchivos[clave] = item.name;
                global.DATOS_COMPARTIDOS.ultimaActualizacion = ahora;
                global.DATOS_COMPARTIDOS.origenActualizacion = "GitHub Repo";
                global.DATOS_COMPARTIDOS.listo = true;
                await guardarEnIndexedDB(clave, matriz, item.name, ahora, "GitHub Repo");
                archivosCargados++;
              }
            }
          } else if ((nombreLower.endsWith(".xlsx") || nombreLower.endsWith(".xls")) && global.XLSX) {
            const rBuf = await fetch(rawUrl);
            if (!rBuf.ok) continue;
            const arrayBuffer = await rBuf.arrayBuffer();
            const wb = global.XLSX.read(new Uint8Array(arrayBuffer), { type: "array", raw: false, cellText: true });
            const firstSheet = wb.Sheets[wb.SheetNames[0]];
            const matriz = global.XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: false }).map(function (f) {
              return (f || []).map(function (c) { return String(c ?? "").trim(); });
            });
            if (matriz.length > 0) {
              const clave = detectarFamiliaDeArchivo(item.name, matriz);
              const info = FAMILIAS_ARCHIVOS[clave];
              if (info) {
                global.DATOS_COMPARTIDOS[info.propData] = matriz;
                global.DATOS_COMPARTIDOS.nombresArchivos[clave] = item.name;
                global.DATOS_COMPARTIDOS.ultimaActualizacion = ahora;
                global.DATOS_COMPARTIDOS.origenActualizacion = "GitHub Repo";
                global.DATOS_COMPARTIDOS.listo = true;
                await guardarEnIndexedDB(clave, matriz, item.name, ahora, "GitHub Repo");
                archivosCargados++;
              }
            }
          }
        } catch (fileErr) {
          console.warn("Aviso al procesar archivo desde GitHub:", item.name, fileErr);
        }
      }

      if (archivosCargados > 0) {
        ejecutarSuscriptores(null);
        if (!silencioso) {
          mostrarNotificacionSync(`✅ ${archivosCargados} archivo(s) sincronizados desde GitHub (/datos_compartidos)`, "exito");
        }
      } else if (!silencioso) {
        mostrarNotificacionSync("ℹ️ No se encontraron archivos nuevos en /datos_compartidos de GitHub.", "cargando");
      }
    } catch (err) {
      console.warn("Aviso al consultar GitHub (/datos_compartidos):", err);
      if (!silencioso) {
        mostrarNotificacionSync("⚡ Usando datos del Contenedor Local (IndexedDB).", "exito");
      }
    }

    return global.DATOS_COMPARTIDOS;
  }

  // ==========================================================================
  // GUARDADO Y PROPAGACIÓN EN CONTENEDOR CENTRAL TRAXIÓN (INSTANTÁNEO + GITHUB)
  // ==========================================================================
  async function publicarArchivoCompartido(clave, matriz, nombreArchivo, origenModulo, silencioso) {
    const infoFam = FAMILIAS_ARCHIVOS[clave];
    if (!infoFam || !Array.isArray(matriz) || matriz.length === 0) return false;

    const ahora = new Date().toLocaleTimeString("es-MX");
    const dc = global.DATOS_COMPARTIDOS;
    dc[infoFam.propData] = matriz;
    if (!dc.nombresArchivos) dc.nombresArchivos = {};
    dc.nombresArchivos[clave] = nombreArchivo || infoFam.nombre;
    dc.ultimaActualizacion = ahora;
    dc.origenActualizacion = origenModulo || "Contenedor Central";
    dc.listo = true;

    // 1. Guardar inmediatamente en la Base de Datos del Contenedor (IndexedDB)
    await guardarEnIndexedDB(clave, matriz, nombreArchivo || infoFam.nombre, ahora, dc.origenActualizacion);

    // 2. Actualizar ventana padre si estamos dentro de un iframe
    try {
      if (global.parent && global.parent !== global) {
        if (global.parent.DATOS_COMPARTIDOS) {
          global.parent.DATOS_COMPARTIDOS[infoFam.propData] = matriz;
          if (!global.parent.DATOS_COMPARTIDOS.nombresArchivos) global.parent.DATOS_COMPARTIDOS.nombresArchivos = {};
          global.parent.DATOS_COMPARTIDOS.nombresArchivos[clave] = nombreArchivo || infoFam.nombre;
          global.parent.DATOS_COMPARTIDOS.ultimaActualizacion = ahora;
          global.parent.DATOS_COMPARTIDOS.origenActualizacion = dc.origenActualizacion;
          global.parent.DATOS_COMPARTIDOS.listo = true;
          if (typeof global.parent.actualizarBadgeEstado === "function") {
            global.parent.actualizarBadgeEstado(true, `Contenedor Activo (${ahora})`);
          }
          if (typeof global.parent.actualizarTarjetasEstadoHub === "function") {
            global.parent.actualizarTarjetasEstadoHub();
          }
        }
        global.parent.postMessage({
          accion: "TRAXION_HIJO_SUBIO_ARCHIVO",
          clave: clave,
          matriz: matriz,
          nombreArchivo: nombreArchivo || infoFam.nombre,
          origen: dc.origenActualizacion,
          timestamp: ahora
        }, "*");
      }
    } catch (e) {
      try {
        if (global.parent && global.parent !== global) {
          global.parent.postMessage({
            accion: "TRAXION_HIJO_SUBIO_ARCHIVO",
            clave: clave,
            matriz: matriz,
            nombreArchivo: nombreArchivo || infoFam.nombre,
            origen: dc.origenActualizacion,
            timestamp: ahora
          }, "*");
        }
      } catch (e2) {}
    }

    // 3. Emitir por BroadcastChannel a otras pestañas abiertas
    if (canalBC) {
      try {
        const payloadBC = {};
        payloadBC[clave] = matriz;
        payloadBC.nombresArchivos = dc.nombresArchivos;
        payloadBC.ultimaActualizacion = ahora;
        payloadBC.origenActualizacion = dc.origenActualizacion;
        canalBC.postMessage({
          tipo: "TRAXION_SYNC_UPDATE",
          claveActualizada: clave,
          payload: payloadBC
        });
      } catch (e) {}
    }

    // 4. Si hay Token de GitHub configurado y no estamos en lote silencioso, subir también a GitHub (/datos_compartidos)
    if (!silencioso && obtenerTokenGitHub()) {
      mostrarNotificacionSync(`🐙 Guardando <b>${infoFam.nombre}</b> en Contenedor Local y GitHub...`, "cargando");
      const lote = {};
      lote[clave] = { matriz: matriz, nombreArchivo: nombreArchivo || infoFam.nombre, origen: dc.origenActualizacion };
      const resGH = await subirLoteAGitHub(lote);
      if (resGH.exito) {
        mostrarNotificacionSync(`✅ <b>${infoFam.nombre}</b> sincronizado en GitHub y en todos los módulos (${matriz.length.toLocaleString()} filas)`, "exito");
        return true;
      }
    }

    if (!silencioso) {
      mostrarNotificacionSync(`✅ <b>${infoFam.nombre}</b> guardado en el Contenedor Central (${matriz.length.toLocaleString()} filas)`, "exito");
    }

    return true;
  }

  async function publicarArchivoDesdeInput(clave, file, origenModulo, silencioso) {
    if (!file) return null;
    try {
      const matriz = await archivoAMatriz(file);
      const claveReal = clave === "auto" ? detectarFamiliaDeArchivo(file.name, matriz) : clave;
      if (matriz && matriz.length > 0) {
        await publicarArchivoCompartido(claveReal, matriz, file.name, origenModulo, silencioso);
      }
      return matriz;
    } catch (err) {
      console.error("Error al procesar archivo en el Contenedor Central:", err);
      return null;
    }
  }

  // ==========================================================================
  // EXPORTAR / IMPORTAR CONTENEDOR PORTABLE (.JSON) Y LIMPIEZA
  // ==========================================================================
  function exportarContenedorJSON() {
    const dc = global.DATOS_COMPARTIDOS;
    if (!dc || !dc.listo) {
      alert("El Contenedor Central aún no tiene archivos cargados para exportar.");
      return;
    }

    const paquete = {
      formato: "CONTENEDOR_CENTRAL_TRAXION_V2",
      fechaExportacion: new Date().toLocaleString("es-MX"),
      datos: serializarDatosCompartidos()
    };

    const blob = new Blob([JSON.stringify(paquete)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = global.document.createElement("a");
    const fechaISO = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `Contenedor_Traxion_${fechaISO}.traxion.json`;
    global.document.body.appendChild(a);
    a.click();
    global.document.body.removeChild(a);
    URL.revokeObjectURL(url);
    mostrarNotificacionSync("💾 Contenedor portable descargado exitosamente", "exito");
  }

  async function importarContenedorJSON(file) {
    if (!file) return false;
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = async function (e) {
        try {
          const contenido = JSON.parse(e.target.result);
          const datosEntrantes = contenido.datos || contenido;
          const huboCambios = aplicarDatosEnMemoria(datosEntrantes, true);
          if (huboCambios) {
            global.DATOS_COMPARTIDOS.ultimaActualizacion = new Date().toLocaleTimeString("es-MX");
            global.DATOS_COMPARTIDOS.listo = true;
            ejecutarSuscriptores(null);
            if (canalBC) {
              canalBC.postMessage({
                tipo: "TRAXION_SYNC_UPDATE",
                claveActualizada: null,
                payload: serializarDatosCompartidos()
              });
            }
            mostrarNotificacionSync("✅ Contenedor portable importado y activado en todos los módulos", "exito");
            resolve(true);
          } else {
            resolve(false);
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file, "UTF-8");
    });
  }

  async function limpiarContenedorCompleto() {
    await limpiarIndexedDB();
    vaciarMemoriaLocal();
    if (canalBC) {
      try {
        canalBC.postMessage({ tipo: "TRAXION_SYNC_CLEAR" });
      } catch (e) {}
    }
    mostrarNotificacionSync("🗑️ Contenedor Central vaciado correctamente", "cargando");
    return true;
  }

  // ==========================================================================
  // INICIALIZACIÓN Y RECUPERACIÓN AUTOMÁTICA (LOCAL + GITHUB REPO)
  // ==========================================================================
  async function inicializarYRecuperarDatos(forzarGitHub) {
    // 1. Intentar leer de ventana padre directamente
    const leidoDePadre = intentarLeerDesdePadreDirecto();

    if (!leidoDePadre) {
      try {
        if (global.parent && global.parent !== global) {
          global.parent.postMessage({ accion: "TRAXION_SOLICITAR_DATOS_AL_PADRE" }, "*");
        }
      } catch (e) {}

      // 2. Leer inmediatamente del Contenedor Local IndexedDB
      const registrosDB = await leerTodoDeIndexedDB();
      if (Array.isArray(registrosDB) && registrosDB.length > 0) {
        const mapaLocal = { nombresArchivos: {} };
        let tsReciente = "";
        let origenReciente = "";
        registrosDB.forEach(function (reg) {
          if (reg && reg.clave && Array.isArray(reg.matriz) && reg.matriz.length > 0) {
            mapaLocal[reg.clave] = reg.matriz;
            mapaLocal.nombresArchivos[reg.clave] = reg.nombreArchivo || reg.clave;
            if (reg.timestamp) tsReciente = reg.timestamp;
            if (reg.origen) origenReciente = reg.origen;
          }
        });
        if (tsReciente && !global.DATOS_COMPARTIDOS.ultimaActualizacion) {
          mapaLocal.ultimaActualizacion = tsReciente;
        }
        if (origenReciente && !global.DATOS_COMPARTIDOS.origenActualizacion) {
          mapaLocal.origenActualizacion = origenReciente;
        }
        aplicarDatosEnMemoria(mapaLocal, false);
      }
    }

    // 3. Si aún no hay datos en memoria o se pidió sincronizar con GitHub, consultar /datos_compartidos en el repo
    const dc = global.DATOS_COMPARTIDOS;
    const tieneDatosLocales = Boolean(
      (dc.existenciasData && dc.existenciasData.length > 0) ||
      (dc.recoleccionData && dc.recoleccionData.length > 0) ||
      (dc.hcargaData && dc.hcargaData.length > 0) ||
      (dc.sapData && dc.sapData.length > 0) ||
      (dc.movimientosWmsData && dc.movimientosWmsData.length > 0)
    );

    if (forzarGitHub || (!leidoDePadre && !tieneDatosLocales)) {
      await descargarDesdeGitHub(true);
    }

    return global.DATOS_COMPARTIDOS;
  }

  async function descargarDesdeNube(silencioso) {
    await inicializarYRecuperarDatos(false);
    await descargarDesdeGitHub(silencioso);
    return global.DATOS_COMPARTIDOS;
  }

  function calcularHuellaDatos(dc) {
    if (!dc) return "";
    return [
      dc.ultimaActualizacion || "",
      Array.isArray(dc.existenciasData) ? dc.existenciasData.length : 0,
      Array.isArray(dc.recoleccionData) ? dc.recoleccionData.length : 0,
      Array.isArray(dc.hcargaData) ? dc.hcargaData.length : 0,
      Array.isArray(dc.sapData) ? dc.sapData.length : 0,
      Array.isArray(dc.movimientosWmsData) ? dc.movimientosWmsData.length : 0,
      Array.isArray(dc.maestroMaterialesData) ? dc.maestroMaterialesData.length : 0,
      Array.isArray(dc.reglasPickBulkData) ? dc.reglasPickBulkData.length : 0,
      Array.isArray(dc.reglasEstibaData) ? dc.reglasEstibaData.length : 0
    ].join("|");
  }

  function alActualizarDatos(callback) {
    if (typeof callback !== "function") return;
    suscriptores.push(callback);

    global.autoRecargarDesdeParent = function () {
      intentarLeerDesdePadreDirecto();
      ejecutarSuscriptores(null);
    };

    const iniciar = async function () {
      await inicializarYRecuperarDatos(false);
      if (global.DATOS_COMPARTIDOS && global.DATOS_COMPARTIDOS.listo) {
        ejecutarSuscriptores(null);
      }
    };

    if (global.document && (global.document.readyState === "complete" || global.document.readyState === "interactive")) {
      setTimeout(iniciar, 60);
    } else if (global.addEventListener) {
      global.addEventListener("DOMContentLoaded", function () {
        setTimeout(iniciar, 60);
      });
    }
  }

  function ejecutarSuscriptores(claveActualizada) {
    if (timerDebounceSuscriptores) clearTimeout(timerDebounceSuscriptores);
    timerDebounceSuscriptores = setTimeout(function () {
      const dc = global.DATOS_COMPARTIDOS;
      const huellaActual = calcularHuellaDatos(dc) + "|" + (claveActualizada || "");
      if (huellaActual === ultimaHuellaSuscriptores && !claveActualizada) {
        return;
      }
      ultimaHuellaSuscriptores = huellaActual;

      suscriptores.forEach(function (fn) {
        try {
          fn(dc, claveActualizada);
        } catch (err) {
          console.error("Error en suscriptor de TraxionSync:", err);
        }
      });
    }, 90);
  }

  function obtenerFamilia(clave, formato) {
    const info = FAMILIAS_ARCHIVOS[clave];
    if (!info) return null;
    const matriz = global.DATOS_COMPARTIDOS[info.propData];
    if (!Array.isArray(matriz) || matriz.length === 0) return null;

    if (formato === "csv") return matrizACsv(matriz);
    if (formato === "objetos") return matrizAObjetos(matriz);
    return matriz;
  }

  // Exponer API pública en español
  global.TraxionSync = {
    GITHUB_CONFIG: GITHUB_CONFIG,
    FAMILIAS: FAMILIAS_ARCHIVOS,
    obtenerDatos: function () { return global.DATOS_COMPARTIDOS; },
    obtenerFamilia: obtenerFamilia,
    detectarFamiliaDeArchivo: detectarFamiliaDeArchivo,
    obtenerTokenGitHub: obtenerTokenGitHub,
    guardarTokenGitHub: guardarTokenGitHub,
    subirLoteAGitHub: subirLoteAGitHub,
    descargarDesdeGitHub: descargarDesdeGitHub,
    matrizACsv: matrizACsv,
    csvAMatriz: csvAMatriz,
    matrizAObjetos: matrizAObjetos,
    objetosAMatriz: objetosAMatriz,
    archivoAMatriz: archivoAMatriz,
    publicarArchivoCompartido: publicarArchivoCompartido,
    publicarArchivoDesdeInput: publicarArchivoDesdeInput,
    descargarDesdeNube: descargarDesdeNube,
    inicializarYRecuperarDatos: inicializarYRecuperarDatos,
    exportarContenedorJSON: exportarContenedorJSON,
    importarContenedorJSON: importarContenedorJSON,
    limpiarContenedorCompleto: limpiarContenedorCompleto,
    alActualizarDatos: alActualizarDatos,
    mostrarNotificacion: mostrarNotificacionSync
  };

})(window);
