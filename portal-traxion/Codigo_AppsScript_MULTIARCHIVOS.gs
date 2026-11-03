/**
 * ============================================================================
 * GOOGLE APPS SCRIPT - HUB CENTRALIZADO "MULTIARCHIVOS" (PORTAL TRAXIÓN)
 * Norma Técnica: TSE-09-SIGEO-PR
 * ============================================================================
 * INSTRUCCIONES DE INSTALACIÓN EN GOOGLE SHEETS:
 * 1. Abre tu hoja de Google Sheets llamada "MULTIARCHIVOS".
 * 2. Ve al menú superior: Extensiones -> Apps Script.
 * 3. Reemplaza el código existente con este código completo y guarda (Ctrl+S).
 * 4. Haz clic en "Implementar" -> "Gestionar implementaciones" -> Editar (ícono lápiz)
 *    -> En "Versión" selecciona "Nueva versión" -> "Implementar".
 *
 * FAMILIAS DE ARCHIVOS SOPORTADAS (6 FAMILIAS):
 * - EXISTENCIAS      : Stock físico WMS Izel (16 columnas, ubicaciones, LPNs, caducidades)
 * - RECOLECCION      : Lista de recolección / Demanda de viajes y SKUs
 * - HCARGA           : Avance WMS de cajas picadas y estatus de viajes
 * - SAP_RECTOR       : Reporte SAP Rector de Inventario / Stock Interbodegas (MX32, MX21, MX20, MX33)
 * - MOVIMIENTOS_WMS  : Log de movimientos WMS Izel (izelcetus_*.csv)
 * - MAESTRO_MAT      : Catálogo Maestro de Materiales (SKU, Descripción, Precio, Estándar Pallet)
 * - REGLAS_PICK_BULK : Reglas de ubicaciones Pick (P) y Bulk (BP) para Surtimiento
 * - REGLAS_ESTIBA    : Reglas de Estiba Máxima y Fondeo para Calidad / Sobrellenado
 * ============================================================================
 */

const MAPA_HOJAS = {
  existencias: "EXISTENCIAS",
  recoleccion: "RECOLECCION",
  hcarga: "HCARGA",
  sap: "SAP_RECTOR",
  movimientos_wms: "MOVIMIENTOS_WMS",
  maestro_materiales: "MAESTRO_MAT",
  reglas_pick_bulk: "REGLAS_PICK_BULK",
  reglas_estiba: "REGLAS_ESTIBA"
};

/**
 * Obtiene o crea una pestaña dentro del libro de Google Sheets
 */
function obtenerOCrearHoja(ss, nombreHoja) {
  let hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) {
    hoja = ss.insertSheet(nombreHoja);
  }
  return hoja;
}

/**
 * Escribe una matriz 2D en una hoja preservando formato de texto puro
 * (evita notación científica en LPNs y conserva ceros a la izquierda)
 */
function guardarMatrizEnHoja(ss, nombreHoja, matriz) {
  if (!matriz || !Array.isArray(matriz) || matriz.length === 0) {
    return 0;
  }

  const hoja = obtenerOCrearHoja(ss, nombreHoja);
  hoja.clearContents();

  // Normalizar el ancho máximo de columnas para que setValues no falle por filas irregulares
  let maxCols = 0;
  for (let i = 0; i < matriz.length; i++) {
    if (Array.isArray(matriz[i]) && matriz[i].length > maxCols) {
      maxCols = matriz[i].length;
    }
  }

  if (maxCols === 0) return 0;

  const matrizNormalizada = matriz.map(function(fila) {
    const f = Array.isArray(fila) ? fila.map(function(c) { return String(c === null || c === undefined ? "" : c); }) : [];
    while (f.length < maxCols) {
      f.push("");
    }
    return f;
  });

  const rango = hoja.getRange(1, 1, matrizNormalizada.length, maxCols);
  rango.setNumberFormat("@"); // Formato texto plano obligatorio
  rango.setValues(matrizNormalizada);

  return matrizNormalizada.length;
}

/**
 * Lee una pestaña completa y devuelve una matriz 2D de textos
 */
function leerMatrizDeHoja(ss, nombreHoja) {
  const hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) return [];
  const lastRow = hoja.getLastRow();
  const lastCol = hoja.getLastColumn();
  if (lastRow === 0 || lastCol === 0) return [];
  return hoja.getRange(1, 1, lastRow, lastCol).getDisplayValues();
}

/**
 * Recibe archivos desde el Portal Maestro (index.html) o desde cualquier módulo hijo
 * Solo actualiza las hojas incluidas en el payload, conservando intactas las demás.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const contenido = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const payload = JSON.parse(contenido);

    const conteos = {};

    for (const clave in MAPA_HOJAS) {
      const nombreHoja = MAPA_HOJAS[clave];
      if (payload[clave] && Array.isArray(payload[clave]) && payload[clave].length > 0) {
        conteos[clave] = guardarMatrizEnHoja(ss, nombreHoja, payload[clave]);
      } else {
        const hojaExistente = ss.getSheetByName(nombreHoja);
        conteos[clave] = hojaExistente ? hojaExistente.getLastRow() : 0;
      }
    }

    // Guardar metadatos de última actualización
    const hojaMeta = obtenerOCrearHoja(ss, "METADATA_SYNC");
    const ahora = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "America/Mexico_City", "dd/MM/yyyy HH:mm:ss");
    hojaMeta.clearContents();
    hojaMeta.getRange(1, 1, 2, 2).setValues([
      ["ULTIMA_ACTUALIZACION", "ORIGEN"],
      [ahora, payload.origen || "Portal Traxión"]
    ]);

    const respuesta = {
      status: "success",
      timestamp: ahora,
      origen: payload.origen || "Portal Traxión",
      filasExistencias: conteos.existencias || 0,
      filasRecoleccion: conteos.recoleccion || 0,
      filasHCarga: conteos.hcarga || 0,
      filasSap: conteos.sap || 0,
      filasMovimientosWms: conteos.movimientos_wms || 0,
      filasMaestroMateriales: conteos.maestro_materiales || 0,
      filasReglasPickBulk: conteos.reglas_pick_bulk || 0,
      filasReglasEstiba: conteos.reglas_estiba || 0
    };

    return ContentService
      .createTextOutput(JSON.stringify(respuesta))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: "error",
        message: err.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Devuelve todos los archivos almacenados en MULTIARCHIVOS (o uno específico si se pasa ?tipo=...)
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tipoSolicitado = e && e.parameter && e.parameter.tipo ? e.parameter.tipo : null;

    const hojaMeta = ss.getSheetByName("METADATA_SYNC");
    let timestamp = "";
    let origen = "";
    if (hojaMeta && hojaMeta.getLastRow() >= 2) {
      const metaVals = hojaMeta.getRange(2, 1, 1, 2).getDisplayValues()[0];
      timestamp = metaVals[0] || "";
      origen = metaVals[1] || "";
    }

    const respuesta = {
      status: "success",
      timestamp: timestamp,
      origen: origen
    };

    if (tipoSolicitado && MAPA_HOJAS[tipoSolicitado]) {
      respuesta[tipoSolicitado] = leerMatrizDeHoja(ss, MAPA_HOJAS[tipoSolicitado]);
    } else {
      for (const clave in MAPA_HOJAS) {
        respuesta[clave] = leerMatrizDeHoja(ss, MAPA_HOJAS[clave]);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify(respuesta))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: "error",
        message: err.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
