# NorthLane Fleet Insights – Project brief

## 1. Escenario
**NorthLane Logistics Inc.** (ficticia): flota de unos 960 vehículos de 35 tipos (semi-trucks, trailers, vans, refrigerados…) repartidos en unas 20 sucursales (códigos `W-EUN/xx`, jerarquía Org Lvl 3 / 4 / 5).
Hoy existe un reporte de Power BI ("Vehicle Downtime Overview") que muestra los episodios de baja (downtime) por vehículo y marca los **casos críticos**: vehículos para los que debería abrirse un **Fleet Review Case (FRC)**. Fleet Operations es dueño del reporte; los supervisores de sucursal solo lo consultan. Los datos se actualizan cada dos semanas.

**Problema:** los supervisores necesitan respuestas puntuales ("¿qué remolques de mi sucursal pasaron más de 20 días parados este semestre?") y no saben usar filtros ni DAX. Terminan pidiéndole cada número a Fleet Operations.

**Solución:** una app web con el dashboard de siempre más un asistente que responde preguntas en lenguaje natural con números correctos, un gráfico y la explicación de cómo se calculó, viendo solo lo que el usuario tiene permiso de ver.

**Posicionamiento:** el paso entre un reporte de BI estático y el autoservicio de datos para usuarios no técnicos, sin perder la gobernanza (una sola definición de cada métrica, permisos por fila).

## 2. Datos fuente (ficticios, `data/source/`)
| Archivo | Contenido | Volumen |
|---|---|---|
| `Downtime Records.xlsx` (hoja `Records`) | Org, ID_Vehicle, Plate Nr, Type, Vehicle Age (en realidad **año de fabricación**), Downtime Category, Days, Start Date, End Date | ~3.180 episodios, feb 2024 – may 2026 |
| `Fleet Review Case Status.xlsx` (hoja `FRC Status`) | Review Case Status, Org, ID_Vehicle, Plate Nr, FRC Start, FRC End, Grace Period Until | ~320 casos, 1 por vehículo |

- **Categorías de baja (4):** Mechanical Breakdown, Scheduled Maintenance, Inspection/Compliance Hold, Accident/Collision Damage.
- **Estados de FRC (6):** Review Case Active – Standard, Review Case Active – Individual, Closed – With Action Plan, Closed – No Action Plan, Declined, Aborted.
- **Limpieza al importar:** recortar espacios (`"Mechanical Breakdown "`), `"-"` como nulo, ignorar columnas auxiliares sin encabezado (p. ej. celdas `MIN(I:I)` / `MAX(I:I)` a la derecha), `Days = 0` en episodios del mismo día (se conserva y se documenta cómo se trata). Cualquier otra anomalía se reporta (p. ej. Days ≠ End − Start, fechas invertidas, vehículos con datos maestros distintos entre filas, FRC de vehículos sin episodios, duplicados).
- **Modelo normalizado:** `organizations` (code, org_lvl_3/4/5), `vehicle_types`, `vehicles` (id, plate, type, manufacture_year, organization), `downtime_events`, `fleet_review_cases`.
- **Desplazamiento de fechas:** el script de importación suma a todas las fechas el mismo número de días, de modo que el registro más reciente quede cerca de hoy. Así las ventanas de 6 y 12 meses siguen teniendo datos. Se guarda el desplazamiento aplicado (para poder comparar con el Power BI original).
- **Script re-ejecutable:** `npm run db:import` borra y recarga solo los datos importados; al final imprime conteos por tabla y el reporte de anomalías.

## 3. Reglas de negocio (capa semántica en vistas SQL)
Interpretación tomada de las medidas DAX del reporte (p. ej. `Condition 1`: `Start Date > FRC End`, `Start Date > TODAY() − 180`, estado no activo, `≥ 3` → "X").
- **Ventana de análisis:** episodios que empiezan o terminan en los últimos 12 meses.
- **FRC activo:** estado `Review Case Active – Standard` o `Review Case Active – Individual`.
- **Caso crítico** (debe abrirse un FRC) si se cumple al menos una:
  1. **Cond. 1:** ≥ 3 episodios en los últimos 6 meses (180 días), contando solo episodios que empiezan después del fin del último FRC y sin FRC activo.
  2. **Cond. 2:** ≥ 20 días de baja en los últimos 6 meses, mismas condiciones.
  3. **Cond. 3:** sin FRC activo y > 20 días de baja en los últimos 12 meses.
  **Decisión (Fase 2):** `is_critical` = Cond. 1 o Cond. 2, igual que el reporte de Power BI (que no implementa la Cond. 3: el vehículo 946 la cumple y no está marcado). La Cond. 3 se calcula y se muestra aparte. Detalle en `docs/METRICS.md`.
  Los detalles exactos (365 días para 12 meses, si cuenta Start o End en el borde, qué pasa sin FRC previo) se confirman en la Fase 2 contra las medidas DAX y se documentan.
- **Métricas definidas y documentadas (`docs/METRICS.md`):**
  - *Downtime days:* suma de `days` de los episodios del período.
  - *Episodes:* cantidad de episodios.
  - *MTTR:* días de baja / episodios (días promedio por episodio).
  - *Días promedio entre episodios:* promedio de la diferencia entre el inicio de un episodio y el fin del anterior del mismo vehículo.
  - *Disponibilidad:* 1 − días de baja / (días del período × vehículos).
  - *Tendencia mensual,* *ranking de vehículos* y *desglose* por tipo, sucursal y categoría.
- Las vistas son la **única fuente** para el dashboard, el asistente y los exportes.

## 4. Usuarios y roles (RLS en todas las tablas)
| Rol | Quién | Puede ver |
|---|---|---|
| `fleet_ops` | Fleet Operations (dueño de la herramienta) | Todo |
| `depot_supervisor` | Supervisor de sucursal | Solo los vehículos, episodios y FRC de su sucursal |
- El asistente hereda los permisos automáticamente: cada consulta corre con el usuario verificado de Neon Auth como contexto de RLS.
- **Demo:** botón "Explore the demo" con dos roles (Fleet Operations / Depot Supervisor de una sucursal). Contraseña demo solo en variable de servidor (`DEMO_PASSWORD`). Registro público desactivado.

## 5. Alcance (funcionalidades)
1. **Dashboard** (réplica web del Power BI): KPIs (casos críticos, vehículos con baja, episodios, días, FRC activos), lista de vehículos con episodios, días, FRC activo, último inicio, último fin y marca de caso crítico; filtros por sucursal, tipo y estado de FRC; búsqueda por ID o patente.
2. **Ficha de vehículo:** línea de tiempo de episodios con el período de FRC sombreado, tabla de episodios, KPIs del vehículo y qué condición de caso crítico cumple (y con qué valores).
3. **Asistente** (pieza central):
   - Chat en inglés, español o alemán; responde en el idioma de la pregunta.
   - Cada respuesta: texto corto + gráfico elegido por el asistente (barras, línea o tabla) + tabla de datos.
   - Botón **"How was this calculated?"**: métrica, filtros, período y herramienta usada.
   - Preguntas de seguimiento con contexto ("¿y solo los remolques?").
   - Preguntas sugeridas al entrar.
   - Si la pregunta no se puede responder con los datos, lo dice: nunca inventa.
   - Botón opcional **"Download (.xlsx)"**: genera el archivo en el navegador solo al hacer clic, con los datos ya mostrados.
4. **Evaluación:** ~30 preguntas de prueba con respuestas correctas calculadas por SQL, en varios idiomas y niveles de dificultad, incluidas preguntas trampa sin respuesta posible. Un script (`npm run eval`) las corre contra el asistente y guarda los resultados; una página muestra el % de aciertos y los fallos. Sin llamadas en vivo al abrir la página.
5. **Operación:** `/api/health`, registro de preguntas (sin datos personales) y log de errores.

## 6. Diseño del asistente (decisiones fijas)
- Vercel AI SDK con Gemini, capa gratuita. Antes de usarlo se verifica en la documentación oficial el modelo Flash vigente y sus límites; si algo dejó de ser gratis, se avisa antes.
- **Tool calling sobre la capa semántica:** 4–6 herramientas tipadas con parámetros validados (métrica, dimensión, filtros, período, top N…). Cada herramienta llama a una vista o función de PostgreSQL con el contexto del usuario (RLS). El modelo nunca escribe SQL libre.
- **Solo lectura:** funciones sin permisos de escritura; límite de filas por respuesta.
- **Gráfico:** el asistente devuelve una especificación JSON validada; el frontend la dibuja con Recharts.
- **Control de uso:** límite diario de preguntas por sesión y global; mensaje claro si se alcanza o si Gemini limita; registro de cada pregunta para la evaluación y el log de errores.
- `GEMINI_API_KEY` solo en el servidor.

## 7. Fuera de alcance (no proponer ni reabrir)
Escritura de datos desde el chat, edición de FRC, correos o notificaciones, historial de chats guardado, "pin to dashboard", app móvil, modelos locales, conexión a sistemas reales de la empresa.

## 8. Simplificaciones conscientes (para explicar en entrevistas)
Neon en lugar de Supabase (la cuenta de Supabase ya usa sus 2 proyectos gratuitos; Neon no pausa proyectos por inactividad); datos ficticios de un export (no se crean en la app: es OLAP, no OLTP); fechas desplazadas para que el demo siga vigente; un FRC por vehículo; una zona horaria (Europe/Berlin); "Vehicle Age" se trata como año de fabricación y la edad se calcula.

## 9. Fases (cada una con su criterio de aceptación)
0. **Setup:** proyecto Next.js, base Neon (Frankfurt) con migraciones dbmate, GitHub. ✔ `/api/health` responde `ok: true` contra Neon.
1. **Modelo de datos e importación:** tablas, limpieza, desplazamiento de fechas, `npm run db:import`. ✔ conteos iguales a los Excel y reporte de anomalías.
2. **Capa semántica:** vistas de métricas y reglas de caso crítico, RLS por rol, rol de base de solo lectura para la app, `docs/METRICS.md`. ✔ la lista de casos críticos coincide con la lógica del Power BI (referencia: 100 casos críticos al 07/08/2026 en el reporte original, calculados con la fecha equivalente desplazada); un supervisor solo ve su sucursal.
3. **App base y dashboard:** login con Neon Auth, demo por rol, dashboard, ficha de vehículo. ✔ números del dashboard = consultas de verificación.
4. **Asistente:** chat, herramientas, gráficos, "How was this calculated?", límites de uso. ✔ responde bien 10 preguntas de ejemplo en 3 idiomas y rechaza una imposible.
5. **Evaluación:** set de 30 preguntas, script y página de resultados. ✔ % de aciertos visible y fallos explicados.
6. **Publicación en Vercel** y prueba de punta a punta con ambos roles y desde el celular. ✔ link público funcionando con los dos roles.
7. **Documentación:** README con capturas y diagrama simple (cómo responde el asistente, paso a paso), `docs/PRODUCTION.md` (qué cambiaría en una empresa real: modelo de pago y privacidad de datos, monitoreo de calidad del asistente, costos), líneas de CV en inglés y alemán y página de Notion (estructura la pasa Andrés). ✔ README y documentos revisados por Andrés.

## 10. Ideas para explicar en entrevistas
1. **Capa semántica:** una sola definición de cada métrica en SQL; dashboard, asistente y exportes no se pueden contradecir (como un modelo de Power BI compartido).
2. **Tool calling en lugar de text-to-SQL:** el modelo elige herramienta y parámetros validados; no puede inventar consultas ni tocar datos.
3. **Permisos heredados:** el asistente consulta como el usuario, así RLS limita lo que puede responder sin lógica extra.
4. **Transparencia:** "How was this calculated?" muestra métrica, filtros y período: el usuario puede auditar la respuesta.
5. **Evaluación medible:** un set de preguntas con respuestas de referencia en SQL convierte "parece que funciona" en un % de aciertos.
6. **De DAX a SQL:** las reglas de caso crítico del reporte original migradas y verificadas contra el mismo resultado.
