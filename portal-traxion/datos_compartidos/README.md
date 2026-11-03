# 🐙 Contenedor Central de Datos Compartidos (`datos_compartidos/`)

Esta carpeta funciona como el **Contenedor de Información en GitHub** para el **Portal de Control Operativo Traxión (`TSE-09-SIGEO-PR`)**.

## ¿Cómo funciona?

Tienes **2 formas** de alimentar este contenedor para que todas las computadoras y todos los módulos (`MODULO1_SAM21`, `SURTIMIENTO`, `Semáforo FG`, `Sobrellenado`, `Balance SAP vs Izel`, `BALANCE 2`, `Interbodegas`, `Productividad`, etc.) reciban los archivos automáticamente:

### Opción A: Subir archivos desde el Portal Web (`index.html` o cualquier módulo)
1. En el Portal Maestro (`index.html`), haz clic en **📤 Subir al Contenedor Central**.
2. Los archivos se guardan **instantáneamente (en menos de 1 segundo)** en la base de datos interna del navegador (`IndexedDB`) compartida por todos los módulos de tu dominio de GitHub Pages (`desarrollotraxion-creator.github.io`).
3. Si además configuras tu **Token de GitHub (`🔑 Token GitHub`)** en el modal del portal, el sistema guardará automáticamente los archivos procesados dentro de esta carpeta (`datos_compartidos/*.json`) en tu repositorio usando la API de GitHub Blobs (soporta archivos de hasta **100 MB** sin los bloqueos de Google Sheets).

### Opción B: Arrastrar archivos `.csv` o `.xlsx` directamente a esta carpeta en GitHub
También puedes subir tus archivos originales (`.csv` o `.xlsx`) directamente a esta carpeta `datos_compartidos/` en GitHub:
- **Existencias WMS:** Cualquier archivo cuyo nombre contenga `existencias`, `inventario` o `stock`.
- **Lista de Recolección:** Cualquier archivo cuyo nombre contenga `recoleccion` o `viajes`.
- **H.CARGA:** Cualquier archivo cuyo nombre contenga `hcarga` o `h.carga`.
- **Reporte SAP Rector / Interbodegas:** Cualquier archivo cuyo nombre contenga `sap`, `rector` o `interbodega`.
- **Log de Movimientos WMS:** Cualquier archivo cuyo nombre contenga `izelcetus` o `movimientos`.
- **Catálogos Maestros:** Archivos con nombre `catalogo`, `maestro`, `reglas_pick` o `estiba`.

Al abrir el portal o presionar **⚡ Sincronizar Contenedor**, el sistema detecta y descarga automáticamente todos los archivos de esta carpeta.
