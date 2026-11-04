# NorthLane Fleet Insights – instrucciones para Claude Code

@AGENTS.md

> Lee `docs/PROJECT_BRIEF.md` al empezar cada fase: ahí están el negocio, el alcance, las reglas y las fases con sus criterios de aceptación.

## Quién soy
Andrés Gantier Müller (Essen, Alemania). Ingeniero Industrial y de Sistemas, M.Sc. Informatics & Business.
BI Analyst: fuerte en Power BI, DAX, modelado de datos y SQL. NO sé desarrollo web ni IA aplicada. Necesito entender la arquitectura y las decisiones, no cada línea de código.
Ya construí SpareLedger y CoverWatch (Next.js + Supabase + Vercel) trabajando con Claude: conozco VS Code, terminal, Git, Supabase SQL Editor y Vercel. Este proyecto usa Neon (también PostgreSQL) en lugar de Supabase.

## Objetivo
Llevar mi reporte de Power BI "Vehicle Downtime Overview" (NorthLane Logistics, ficticia) a una app web con:
1. El dashboard de siempre (réplica web) sobre una capa semántica en PostgreSQL.
2. Un asistente que responde preguntas en lenguaje natural con números correctos, gráfico y explicación de cómo se calculó, respetando los permisos del usuario.
3. Una evaluación medible del asistente (% de aciertos sobre un set de preguntas con respuestas calculadas por SQL).
Que se pueda mostrar con un link público y explicar con seguridad en entrevistas. Todo con herramientas gratuitas.

## Cómo trabajamos
- Tú haces todo el trabajo técnico: diseño, código, SQL, métricas, datos, preguntas de prueba, pruebas y documentación. Yo apruebo, pruebo en el navegador y pregunto. No me pidas programar ni definir métricas.
- Trabaja fase por fase (ver el brief). Antes de empezar una fase, resúmeme en 3–5 líneas qué vas a hacer y espera mi OK.
- Al cerrar cada fase dame: qué se hizo (3–5 líneas), cómo lo verifico (qué abrir y qué debería ver), 2–3 líneas para explicarlo en una entrevista y, en **modo aprendizaje**, 5–8 líneas a nivel principiante sobre el concepto detrás (p. ej. tool calling, capa semántica, RLS, evaluación de un agente) y por qué se eligió así.
- Mi participación se limita a cuentas y paneles: proyecto de Neon (y activar Neon Auth), API key de Gemini, repo de GitHub, conectar Vercel y cargar variables. Las cadenas de conexión y claves las pego yo en `.env.local`, nunca en el chat. Para eso: pasos numerados exactos, como para alguien que nunca lo hizo.
- **Ahorro de créditos:** nunca navegues paneles web para buscar o copiar valores (keys, URLs, configuraciones). Pídemelos con pasos claros: los copio yo.
- Nunca me pidas ni escribas claves en archivos que se suben a GitHub. Van en `.env.local` (y yo las cargo en Vercel). No inventes datos que dependen de mí (cuentas, URLs): pídemelos.
- Si hay varias formas de hacer algo, elige la estándar en la industria y explícala en una línea.
- Si algo falla, investiga la causa, corrígelo y explícame en 2–3 líneas qué era.
- Verifica antes de decir que algo funciona: `npm run build` y `npm run lint` sin errores, y la prueba de la fase.
- Commits: solo cuando yo confirme que la fase funciona, mensaje en inglés `Phase N: ...` y push a `main`. No hagas push sin mi confirmación.
- No agregues funcionalidades fuera del brief ni reabras lo que está fuera de alcance. Las ideas extra van a `docs/IDEAS.md`.

## Formato de tus respuestas
- Español latinoamericano, conciso, natural, sin relleno. Directo y honesto.
- Explicaciones a nivel principiante en desarrollo web e IA; puedes asumir que sé SQL, DAX y modelado de datos (usa analogías con Power BI cuando ayuden).
- Código, interfaz, base de datos y documentación en inglés. Comentarios breves en inglés.
- No mencionar IA en el README ni en las líneas de CV salvo para describir la funcionalidad del asistente.

## Stack (todo gratis)
- Next.js (App Router) + TypeScript, Tailwind CSS, shadcn/ui, Recharts.
- Vercel AI SDK + Google Gemini, capa gratuita: `gemini-3.5-flash-lite` (3.8 Flash daba 503 por demanda y 3.6 Flash permite solo 20 llamadas por día). Límite por minuto bajo: no lanzar muchas preguntas seguidas.
- Neon: PostgreSQL serverless (plan gratis: no se pausa ni se borra por inactividad) + Neon Auth (Managed Better Auth, `@neon/auth`) para el login.
- Migraciones con `dbmate` (archivos SQL planos con `-- migrate:up` / `-- migrate:down`).
- `exceljs` en el navegador con carga diferida (solo al hacer clic en "Download (.xlsx)").
- GitHub (código) + Vercel (publicación automática en cada push).
- Si alguna pieza dejó de ser gratuita o cambió, avísame antes de seguir.

## Entorno
- Windows 11, PowerShell, VS Code, Node.js LTS, Git. Navegador Chrome.
- Carpeta del proyecto: `C:\Users\andre\dev\northlane-vehicle-downtime` (confírmalo con `pwd`).
- Datos fuente (ficticios): `data/source/Downtime Records.xlsx` y `data/source/Fleet Review Case Status.xlsx`.
- Capturas del Power BI original (referencia): `C:\Users\andre\Desktop\Portfolio\Vehicle Downtime Analysis - NorthLane\Screenshots\`.
- Neon: región AWS Europe (Frankfurt) `aws-eu-central-1`. Vercel: misma región, `fra1` (`vercel.json` → `regions`).
- Por qué Neon y no Supabase: la cuenta de Supabase ya tiene los 2 proyectos gratuitos activos (SpareLedger y CoverWatch).

## Arquitectura (reglas fijas)
- **La capa semántica vive en PostgreSQL:** vistas y funciones con las métricas y las reglas de caso crítico. Dashboard, asistente y exportes leen SOLO de ellas, así nunca se contradicen. Ninguna métrica se recalcula en TypeScript.
- **Row Level Security en TODAS las tablas.** `fleet_ops` ve todo; `depot_supervisor` solo su sucursal. Vistas con `security_invoker = true` y funciones `SECURITY INVOKER`. La app consulta con un rol de base de solo lectura (no el dueño) y, en cada consulta, una transacción fija el usuario verificado de Neon Auth (`set_config` local + `SET LOCAL ROLE`); las políticas RLS leen ese valor. Sin usuario fijado, RLS no devuelve filas (falla cerrado).
- **Asistente = tool calling sobre la capa semántica:** 4–6 herramientas tipadas con parámetros validados (zod); cada una llama a una vista/función con el contexto del usuario (RLS). El modelo nunca escribe SQL libre. Solo lectura y límite de filas por respuesta. Única escritura (Fase 5b): abrir un FRC, que el modelo solo propone y el usuario confirma; la ejecuta una función de la base con permisos, idempotencia y auditoría.
- La especificación del gráfico la devuelve el asistente como JSON validado; el frontend lo dibuja con Recharts.
- `DATABASE_URL`, `GEMINI_API_KEY`, `NEON_AUTH_COOKIE_SECRET` y `DEMO_PASSWORD` solo en el servidor; nunca en el navegador. La cadena del rol dueño (`neondb_owner`) solo se usa en mi computadora para migraciones e importación; Vercel recibe la del rol de la app.
- Control de uso: límite diario por sesión y global, mensaje claro al alcanzarlo o si Gemini limita, y registro de cada pregunta sin datos personales.
- Cambios de base de datos SOLO como migraciones en `db/migrations/` con dbmate (`npm run db:migrate`). Los datos entran por el script de importación re-ejecutable (`npm run db:import`), nunca a mano.
- Antes de usar un comando o flag de dbmate, Neon (`@neon/auth`, `@neondatabase/serverless`), Vercel, Next.js o AI SDK, verifica que exista en la versión instalada (`--help`, `node_modules/next/dist/docs/`, tipos del paquete `ai`).

## Lecciones de proyectos anteriores (aplícalas desde el inicio)
- Next.js 16 con `cacheComponents`: todo lo que lea sesión o datos en vivo va dentro de `<Suspense>` y empieza con `await connection()`. `usePathname()` en el layout también va en `<Suspense>`.
- La protección de rutas va en `proxy.ts` (Next.js 16) con el middleware de `@neon/auth`; la identidad se verifica siempre en el servidor, nunca se confía en datos del navegador.
- Variables (todas de servidor, sin `NEXT_PUBLIC_`): `DATABASE_URL` (dueño, solo local), `APP_DATABASE_URL` (solo lectura, la que va a Vercel), `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `GEMINI_API_KEY`, `DEMO_PASSWORD`.
- En Vercel, cargar las variables ANTES del primer deploy. Después de cambiar cualquier variable hay que hacer Redeploy (las `NEXT_PUBLIC_`, si alguna vez hay, se incrustan al compilar).
- `create-next-app` no corre en una carpeta con archivos: generar en una subcarpeta temporal y mover, conservando `CLAUDE.md`, `docs/` y `data/`. Si el generador crea su propio `AGENTS.md`, se importa en este archivo.
- Si el servidor de desarrollo lleva mucho tiempo corriendo y algo falla sin explicación, probar con un build de producción antes de cambiar código.
- Los avisos LF/CRLF de Git en Windows son inofensivos. Nunca `npm audit fix --force`.
- La app corre con `npm run dev` en una terminal; los demás comandos van en otra.
- Neon gratis "duerme" la base tras 5 min sin uso y la despierta sola en la siguiente consulta (la primera puede tardar un poco más). Límite: 100 CU-horas de cómputo por mes y proyecto.
- En el portfolio solo se muestra lo que yo puedo explicar: diagramas simples, sin detalles internos de Next.js.

## Conexiones (base de datos, GitHub, publicación)
- Tú ejecutas los comandos en mi computadora. Git ya está conectado a GitHub; Vercel se conecta al repo una vez desde su panel (con tus pasos).
- Base de datos: migraciones e importación usan `DATABASE_URL` de `.env.local` (rol dueño, solo local). Nunca se sube a GitHub.
- Claves: yo copio la cadena de conexión, la Auth URL de Neon y `GEMINI_API_KEY` a `.env.local`; tú me dices exactamente dónde encontrarlas.

## Comandos
- `npm run dev` – app local en http://localhost:3000
- `npm run build` / `npm run lint` – verificación antes de cada cierre de fase
- `npm run db:migrate` – aplica las migraciones pendientes (`npm run db:status` las lista; `npm run db:new <name>` crea una)
- `npm run db:import` – importa y limpia los Excel, desplaza las fechas (Fase 1)
- `npm run db:app-role` – fija la contraseña del login de solo lectura `app_login` y escribe `APP_DATABASE_URL` en `.env.local`
- `npm run db:demo-users` – crea o verifica las dos cuentas demo en Neon Auth y su perfil en `app_users`
- `npm run db:sql -- <archivo.sql> [--app]` – corre consultas de verificación (`db/verify/`) como dueño o, con `--app`, como la app
- `npm run ask -- [--supervisor] "pregunta" ["seguimiento"]` – pregunta al asistente desde la terminal como un rol demo (gasta cuota de Gemini)
- `npm run eval` – corre el set de evaluación contra el asistente (Fase 5)
