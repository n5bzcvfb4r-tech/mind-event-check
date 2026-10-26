# TSK-015 · Suscripción de facturación (MOD-002) a los resultados de reembolso

- Componente dueño: `ARC-023`
- Arquetipo del repo: `event` — respeta sus convenciones; NUNCA te salgas de él (ver «Contrato de salida del arquetipo»).
- Zonas de código de ESTA tarea (trabajo principal): `sources/components/mod002_refund_results_consumer.json`. Fuera de ellas NO amplíes alcance de negocio — **EXCEPTO** el composition root y el manifiesto del host necesarios para montar lo entregado (sección Composition root).

## Definition of Done
Reutiliza los canales y esquemas de TSK-07 por referencia; no redeclara los records de reembolso. Declara a ARC-031 como consumidor de `refund_completed` y `refund_failed` con `idempotency_key = cancellation_id`, `match_field = refund_request_id` y los estados finales declarados (REEMBOLSADO / REEMBOLSO_FALLIDO con `failure_code`) junto a `final_state_immutable: true` (AC-DEV-08: un mensaje duplicado, tardío o con `refund_request_id` distinto no reabre un estado final y queda registrado). Política de entrega declarada: reintentos 1/5/15/60 min con alerta a ADMIN al agotarse (AC-DEV-09). Oráculos: `npm test` verde; test de contrato que entrega dos veces el mismo `refund_completed` y uno con `refund_request_id` distinto y comprueba que la regla de inmutabilidad declarada los descarta registrándolos.

## Oráculos de verificación (dod-oracles) — OBLIGATORIO

El DoD se evalúa por **comportamiento**, no porque exista un fichero o un string «implementado». Lo siguiente es **Blocker** si lo usas como entrega de producto (los dobles solo valen en tests):

- **Auth / rol (p. ej. ADMINISTRADOR):** dependency o middleware que devuelve 401/403 sin credencial/rol; tests con y sin permiso. **Un CRUD abierto no cumple «solo admin».**

Si el entorno de prueba no levanta el servicio necesario: escribe el código de producto real + tests, declara Warning `entorno-de-prueba`, y **NO** sustituyas el DoD con un fake en el código entregado.

## Composition root (composition-root) — OBLIGATORIO

Un módulo con router/controller que **no está montado** en el composition root del proceso NO cuenta como entregado.

Raíces reales del arquetipo `event`: `sources/`. El composition root y el código nuevo viven BAJO esas raíces; no abras un segundo árbol (`src/` junto a `sources/`, `backend/` junto a `apps/`).

En ESTA misma tarea (aunque `zone_paths` no lo liste):
1. Localiza el composition root (`src/main.py`, `app/main.py`, `*Application.java` + scan, `Program.cs`, …).
2. Si no existe (repo vacío / BYO), créalo siguiendo el arquetipo y monta ahí tu router — no dejes el módulo huérfano.
3. Registra el router/controller nuevo (`include_router`, bean MVC, route config…). Si defines `public_router` (o equivalente público), **móntalo también**.
4. Prefijos/paths alineados con `openapi.yaml` del repo (o `.mind`).
5. Smoke: import/arranque del composition root no falla por tu cambio (p. ej. `from src.main import app` / `./mvnw -q compile`).

**Excepción a zone_paths:** el composition root y el manifiesto de deps del host (`requirements.txt` / `pom.xml` / …) SÍ se tocan para cablear lo entregado. No refactores módulos ajenos ni amplíes alcance de negocio.

## Lo entregado tiene que ARRANCAR (boot-gate) — OBLIGATORIO

Compilar no es arrancar. Antes de entregar, arranca el proceso y golpea un endpoint: es lo que separa «el módulo compila» de «el producto funciona», y no lo ve ningún compilador.

1. **Configuración por entorno.** Toda conexión a un sistema externo (base de datos, cola, API) parametrizada con valor por defecto (`${VAR:default}`). Nada de hosts fijos en el fuente.
2. **Nada a medio cablear.** Si escribes una consulta, un repositorio o un cliente, INVÓCALO desde el camino real. El trabajo hecho y sin cablear es la firma de una feature entregada a medias.
3. **Despliegue coherente.** Si tocas `docker-compose.yml`: el motor de la imagen, la URL de conexión y el driver declarado en el manifiesto son UN SOLO hecho. `depends_on` sobre un servicio con estado lleva `condition: service_healthy`. Imágenes base multiarch, y no referencies contextos ni Dockerfile que no existan.

**Un `TODO`, un `not implemented` o un retorno vacío como cuerpo ÚNICO de una función es un bloqueante de entrega, no una nota.** Un endpoint que responde `200 OK` con algo que no depende de ninguna entrada ni de ninguna consulta no es una feature: es una fachada.

## Imports de tests (test-imports) — OBLIGATORIO

Los tests y el `conftest` deben usar **el mismo composition root y el mismo prefijo de paquete** que el código productivo. Un árbol inventado (`src.app.main` cuando el app está en `src/main.py`) no es entrega.

1. Localiza el composition root real (`src/main.py`, `app/main.py`, …) — el mismo composition root.
2. Importa la app **solo** desde ese módulo (p. ej. si existe `src/main.py` y NO `src/app/main.py` → `from src.main import app`). **PROHIBIDO** `from src.app.main import app`.
3. Elige UN prefijo de paquete alineado con el código productivo (`from src.app.<mod>…` **o** `from app.<mod>…` con `PYTHONPATH`/`pytest.ini` coherente). No mezcles ambos en la misma suite.
4. Declara la política en `pytest.ini` / `pyproject.toml` (`pythonpath`) si aún no existe.
5. Importa solo símbolos que **existen** en el fuente (lee el fichero): no inventes `get_page_service` en `service.py` si vive en `router.py`; no inventes clases (`Class` vs `ClassModel`).
6. Smoke: `python -c "from src.main import app"` (o el import canónico) y, si hay pytest, una recolección sin `ModuleNotFoundError`.

## Los tests tienen que EJECUTARSE (suite-exec) — OBLIGATORIO

Un fichero de test que ningún runner recoge es PEOR que no tenerlo: da una señal de cobertura falsa. Antes de entregar:

1. **Cuenta.** Los tests que has escrito y los que el runner ejecuta tienen que ser los mismos. Ejecuta la suite y comprueba el número.
2. **Corre en un clon limpio.** Sin variables de entorno de la plataforma. Todo `process.env.X` con valor por defecto, y toda dependencia externa de test declarada y levantada por el propio repo.
3. **No parchees la aplicación desde el test.** Si el contexto no levanta, el arreglo va en la configuración productiva. Un `@ComponentScan`/`@EntityScan`/`@EnableJpaRepositories` en una clase de test pone el test en verde y deja el producto roto.
4. **Surefire vs failsafe.** Surefire recoge `*Test`/`Test*`/`*Tests`. Para `*IT` hace falta `maven-failsafe-plugin` **con sus ejecuciones declaradas** (`integration-test` + `verify`): sin él, un `AlgoIT.java` se compila, se commitea y no se ejecuta jamás.
   - **Comprueba primero si el `pom.xml` ya lo trae**, que es lo normal en el esqueleto del arquetipo. Si no está, **configúralo**: el `pom.xml` del host es una EXCEPCIÓN explícita a `zone_paths` (ver composition-root), así que tocarlo para cablear lo que entregas es parte del encargo, no salirse de alcance.
   - Y ojo al comando: `mvn test` ejecuta SOLO los unitarios y sale en verde aunque el IT no haya corrido. El que valida la entrega es **`mvn verify`**. Si cuentas los tests ejecutados con `mvn test`, vas a contar de menos.
5. **Datasource de test propio.** Aislado y efímero (Testcontainers con la imagen real; H2 en modo Oracle como mínimo). Sin él los tests heredan el datasource de producción y salen a buscar la base de datos real.

## Imports canónicos (canonical-imports) — OBLIGATORIO

Usa **solo** módulos que existen en el repo o que sembró el scaffolding PR #0.

- Entrypoint típico: `src/backend/app/main.py` con paquete `app` (PYTHONPATH = `src/backend/`).
- DB / email / deps: `app.database`, `app.email` — **NO** inventar `app.core.database`, `app.core.email` ni `app.dependencies` si no hay fichero.
- Tests y producto: **el mismo prefijo** (`from app.modules…`, no mezclar con `app.core…` fantasma).
- Si importas un paquete de terceros (`sqlalchemy`, `motor`, …), decláralo pineado en `requirements.txt` / `pyproject.toml` del host.

## Dependencias pineadas (dependency-pins) — OBLIGATORIO

Un manifiesto sin versiones (o incompleto frente a los imports) NO es entrega válida.

1. **Python:** en `requirements.txt` / deps de `pyproject.toml` cada paquete lleva pin (`==` preferido, o rango acotado `>=x,<y`). **PROHIBIDO** listar solo el nombre (`fastapi`, `uvicorn`, `pydantic`).
2. **Completitud:** toda librería de terceros que importes (`sqlalchemy`, `pydantic`, `motor`, …) debe figurar en el manifiesto.
3. **API ↔ major:** el código debe ser compatible con el major pineado. Si usas `__modify_schema__` / `@validator` / `from_orm` (Pydantic v1), pinea `pydantic>=1.10,<2` (o equivalente). Si pegas Pydantic 2, usa APIs v2 (`field_validator`, `model_validate`). NUNCA código v1 + install latest.
4. **Node:** versiones en `package.json` + `package-lock.json` cuando toques deps; no dejes dependencias sin versión.
5. Actualiza el manifiesto del host en ESTA tarea (misma excepción de zona que el composition root).

## Extiende la zona, no la reimplementes (zone-extend) — OBLIGATORIO

Tus zonas (`sources/components/mod002_refund_results_consumer.json`) pueden ya contener código de una TSK predecesora mergeada (o del esqueleto). Antes de crear tipos nuevos:

1. **Lista y lee** los ficheros bajo la zona (`ls` / abre `service.py`, `router.py`, …).
2. **EDIT/EXTIENDE** clases, funciones y exports existentes. **PROHIBIDO** una segunda `class`/`def`/export con el **mismo nombre** en el mismo fichero (en Python gana la última y el resto es basura).
3. Si esta tarea es «API pública» / «consulta» sobre el mismo dominio que un CRUD previo, **reutiliza** servicios y modelos; añade solo el router/handlers públicos (montados en el composition root).
4. Un módulo = un dueño semántico de cada símbolo top-level. Si hace falta otro tipo, **nómbralo distinto** o factoriza — no pegues un duplicado al EOF.

El runtime puede anexar la lista real de ficheros presentes en la zona al arrancar la sesión.

## Contrato API congelado (api-contract) — LEY

El `openapi.yaml` del repo (PR #0 / C.2) es el contrato de esta API. Esta tarea no es dueña de ningún endpoint: la tabla va como CONTEXTO — no montes rutas nuevas, y si tocas las que hay, respétalas al pie de la letra.

| EP | Método | Path | Request | Response | Status | Errores | Public | Roles |
|----|--------|------|---------|----------|--------|---------|--------|-------|
| `EP-001` | **POST** | `/users` | `UserRegistrationRequest` | `UserRegistrationResponse` | 201 | — | N | deny-all |
| | | _Registra un socio con sus datos personales y su contraseña, y envía el email de confirmación_ | | | | | | |
| `EP-002` | **GET** | `/users/availability` | `—` | `UserAvailabilityResponse` | 200 | — | N | deny-all |
| | | _Comprueba si un email o un nick están libres antes del registro_ | | | | | | |
| `EP-003` | **POST** | `/email-verifications` | `EmailVerificationConfirmRequest` | `EmailVerificationResult` | 201 | — | N | deny-all |
| | | _Confirma el email con el token del enlace y activa la cuenta_ | | | | | | |
| `EP-004` | **POST** | `/email-verification-resends` | `EmailVerificationResendRequest` | `AcceptedResponse` | 201 | — | N | deny-all |
| | | _Reenvía el enlace de confirmación con un token nuevo de 24 h_ | | | | | | |
| `EP-005` | **POST** | `/sessions` | `LoginRequest` | `SessionResponse` | 201 | — | N | deny-all |
| | | _Inicia sesión con email o nick y contraseña, y emite la sesión segura_ | | | | | | |
| `EP-006` | **DELETE** | `/sessions/current` | `—` | `—` | 204 | — | N | deny-all |
| | | _Cierra y revoca la sesión actual_ | | | | | | |
| `EP-007` | **GET** | `/me/sessions` | `—` | `SessionList` | 200 | — | N | deny-all |
| | | _Lista las sesiones abiertas del socio_ | | | | | | |
| `EP-008` | **DELETE** | `/me/sessions/{sessionId}` | `—` | `—` | 204 | — | N | deny-all |
| | | _Revoca una sesión propia_ | | | | | | |
| `EP-009` | **GET** | `/me/profile` | `—` | `ProfileDetail` | 200 | — | N | deny-all |
| | | _Devuelve los datos personales del socio autenticado_ | | | | | | |
| `EP-010` | **PATCH** | `/me/profile` | `ProfileUpdateRequest` | `ProfileDetail` | 200 | — | N | deny-all |
| | | _Actualiza los datos personales editables (todos salvo el nick)_ | | | | | | |
| `EP-011` | **PUT** | `/me/password` | `PasswordChangeRequest` | `—` | 200 | — | N | deny-all |
| | | _Cambia la contraseña verificando la actual y revoca las demás sesiones_ | | | | | | |
| `EP-012` | **POST** | `/password-resets` | `PasswordResetRequest` | `AcceptedResponse` | 201 | — | N | deny-all |
| | | _Solicita el enlace de recuperación de contraseña con una respuesta genérica_ | | | | | | |
| `EP-013` | **POST** | `/password-resets/token-validations` | `PasswordResetTokenRequest` | `PasswordResetTokenStatus` | 201 | — | N | deny-all |
| | | _Valida el token de recuperación antes de mostrar el formulario_ | | | | | | |
| `EP-014` | **POST** | `/password-resets/confirmations` | `PasswordResetConfirmRequest` | `—` | 201 | — | N | deny-all |
| | | _Fija la nueva contraseña y consume el token de recuperación_ | | | | | | |
| `EP-015` | **GET** | `/me/payment-methods` | `—` | `PaymentMethodList` | 200 | — | N | deny-all |
| | | _Lista los métodos de pago activos del socio, enmascarados_ | | | | | | |
| `EP-016` | **POST** | `/me/payment-methods/bank-accounts` | `BankAccountCreateRequest` | `PaymentMethodSummary` | 201 | — | N | deny-all |
| | | _Registra un IBAN validado según ISO 13616 y lo guarda cifrado_ | | | | | | |
| `EP-017` | **POST** | `/me/payment-methods/cards` | `CardPaymentMethodCreateRequest` | `PaymentMethodSummary` | 201 | — | N | deny-all |
| | | _Registra una tarjeta tokenizada en el gateway, sin persistir el PAN ni el CVV_ | | | | | | |
| `EP-018` | **POST** | `/me/payment-methods/paypal-authorizations` | `—` | `PayPalAuthorizationResponse` | 201 | — | N | deny-all |
| | | _Inicia la vinculación OAuth2 de PayPal y devuelve la URL de autorización_ | | | | | | |
| `EP-019` | **POST** | `/me/payment-methods/paypal-accounts` | `PayPalAccountLinkRequest` | `PaymentMethodSummary` | 201 | — | N | deny-all |
| | | _Completa la vinculación de PayPal con el código y el state del callback_ | | | | | | |
| `EP-020` | **PUT** | `/me/payment-methods/default` | `DefaultPaymentMethodRequest` | `PaymentMethodSummary` | 200 | — | N | deny-all |
| | | _Marca un método de pago como el único predeterminado_ | | | | | | |
| `EP-021` | **DELETE** | `/me/payment-methods/{paymentMethodId}` | `—` | `—` | 204 | — | N | deny-all |
| | | _Elimina de forma lógica un método de pago propio y reasigna el predeterminado_ | | | | | | |
| `EP-022` | **POST** | `/me/payment-methods/{paymentMethodId}/replacements` | `CardReplacementRequest` | `CardReplacementResult` | 201 | — | N | deny-all |
| | | _Sustituye una tarjeta caducada o próxima a caducar y reanuda el dunning suspendido_ | | | | | | |
| `EP-023` | **GET** | `/subscription-plans` | `—` | `SubscriptionPlanList` | 200 | — | N | deny-all |
| | | _Muestra las modalidades activas con precio, equivalente mensual y ahorro_ | | | | | | |
| `EP-024` | **POST** | `/me/subscriptions` | `SubscriptionCreateRequest` | `SubscriptionCreated` | 201 | — | N | deny-all |
| | | _Contrata una suscripción con una modalidad y un método de pago, y emite la factura inicial_ | | | | | | |
| `EP-025` | **GET** | `/me/subscription` | `—` | `SubscriptionSummary` | 200 | — | N | deny-all |
| | | _Devuelve la modalidad, la próxima renovación, el método enmascarado y el estado de baja y devolución_ | | | | | | |
| `EP-026` | **POST** | `/me/subscription/plan-changes` | `PlanChangeRequest` | `PendingPlanChange` | 201 | — | N | deny-all |
| | | _Programa un cambio de modalidad para la siguiente fecha de ciclo_ | | | | | | |
| `EP-027` | **DELETE** | `/me/subscription/plan-changes/{planChangeId}` | `—` | `—` | 204 | — | N | deny-all |
| | | _Anula un cambio de modalidad pendiente hasta la víspera de su aplicación_ | | | | | | |
| `EP-028` | **GET** | `/me/subscription/cancellation-preview` | `—` | `CancellationPreview` | 200 | — | N | deny-all |
| | | _Calcula, sin persistir nada, el importe proporcional a devolver y el método de devolución_ | | | | | | |
| `EP-029` | **POST** | `/me/subscription/cancellations` | `CancellationRequest` | `CancellationReceipt` | 201 | — | N | deny-all |
| | | _Confirma la baja, detiene la facturación y lanza la devolución proporcional_ | | | | | | |
| `EP-030` | **GET** | `/me/dashboard` | `—` | `SubscriptionDashboard` | 200 | — | N | deny-all |
| | | _Devuelve en una sola carga facturas, próximo cobro, modalidad y avisos priorizados_ | | | | | | |
| `EP-031` | **GET** | `/me/invoices` | `—` | `InvoiceHistory` | 200 | — | N | deny-all |
| | | _Lista las facturas de los últimos 12 meses con su estado de pago real_ | | | | | | |
| `EP-032` | **POST** | `/me/invoices/{invoiceId}/payments` | `InvoicePaymentRequest` | `PaymentAttemptResult` | 201 | — | N | deny-all |
| | | _Inicia el pago de una factura propia con el método elegido, de forma idempotente_ | | | | | | |
| `EP-033` | **GET** | `/me/payment-transactions` | `—` | `PaymentTransactionPage` | 200 | — | N | deny-all |
| | | _Lista los cobros propios con filtros y paginación, sin datos de tarjeta_ | | | | | | |
| `EP-034` | **GET** | `/me/payment-transactions/{transactionId}` | `—` | `PaymentTransactionDetail` | 200 | — | N | deny-all |
| | | _Consulta el estado de un cobro propio (retorno, espera o verificación)_ | | | | | | |
| `EP-035` | **POST** | `/me/payment-transactions/{transactionId}/sca-confirmations` | `ScaConfirmationRequest` | `PaymentAttemptResult` | 201 | — | N | deny-all |
| | | _Confirma el resultado del desafío 3-D Secure de un cobro con tarjeta_ | | | | | | |
| `EP-036` | **POST** | `/me/payment-transactions/{transactionId}/paypal-captures` | `PayPalCaptureRequest` | `PaymentAttemptResult` | 201 | — | N | deny-all |
| | | _Captura el cobro PayPal cuando el pagador lo ha aprobado_ | | | | | | |
| `EP-037` | **GET** | `/me/bank-transactions` | `—` | `BankTransactionPage` | 200 | — | N | deny-all |
| | | _Lista las transferencias propias de los últimos 12 meses (Mis pagos)_ | | | | | | |
| `EP-038` | **GET** | `/me/refunds` | `—` | `RefundStatusList` | 200 | — | N | deny-all |
| | | _Lista los reembolsos propios con su estado de negocio_ | | | | | | |
| `EP-039` | **GET** | `/me/nfc-credentials` | `—` | `NfcCredentialList` | 200 | — | N | deny-all |
| | | _Consulta el estado de la credencial NFC del socio_ | | | | | | |
| `EP-040` | **POST** | `/me/nfc-credentials` | `NfcCredentialActivationRequest` | `NfcCredentialDetail` | 201 | — | N | deny-all |
| | | _Activa una credencial NFC ligada al dispositivo, previa reautenticación_ | | | | | | |
| `EP-041` | **DELETE** | `/me/nfc-credentials/{credentialId}` | `—` | `—` | 204 | — | N | deny-all |
| | | _Desactiva la credencial NFC propia de forma idempotente_ | | | | | | |
| `EP-042` | **GET** | `/admin/users` | `—` | `AdminUserPage` | 200 | — | N | deny-all |
| | | _Lista los usuarios con su perfil, suscripción y estado de facturación, con búsqueda y filtros_ | | | | | | |
| `EP-043` | **GET** | `/admin/user-stats` | `—` | `AdminUserStats` | 200 | — | N | deny-all |
| | | _Devuelve el resumen agregado por estado de suscripción, modalidad y facturación_ | | | | | | |
| `EP-044` | **GET** | `/admin/users/{userId}` | `—` | `AdminUserDetail` | 200 | — | N | deny-all |
| | | _Abre la ficha de solo lectura de un usuario y deja traza de auditoría_ | | | | | | |
| `EP-045` | **DELETE** | `/admin/users/{userId}/sessions` | `—` | `SessionRevocationResult` | 204 | — | N | deny-all |
| | | _Revoca todas las sesiones activas de un usuario_ | | | | | | |
| `EP-046` | **POST** | `/admin/users/{userId}/unlocks` | `—` | `—` | 201 | — | N | deny-all |
| | | _Desbloquea una cuenta bloqueada por intentos fallidos y revoca sus sesiones_ | | | | | | |
| `EP-047` | **GET** | `/admin/payment-methods` | `—` | `PaymentMethodPage` | 200 | — | N | deny-all |
| | | _Lista los métodos de pago de todos los usuarios, enmascarados y con auditoría_ | | | | | | |
| `EP-048` | **GET** | `/admin/transactions` | `—` | `LedgerEntryPage` | 200 | — | N | deny-all |
| | | _Consulta el registro consolidado de transacciones con filtros y totales_ | | | | | | |
| `EP-049` | **GET** | `/admin/transactions/{ledgerId}` | `—` | `LedgerEntryTrace` | 200 | — | N | deny-all |
| | | _Muestra la traza completa de un asiento con sus reembolsos y su conciliación_ | | | | | | |
| `EP-050` | **GET** | `/admin/correlations/{correlationId}/events` | `—` | `TransactionEventTimeline` | 200 | — | N | deny-all |
| | | _Devuelve en orden cronológico los eventos de un correlation_id_ | | | | | | |
| `EP-051` | **POST** | `/admin/ledger-integrity-checks` | `—` | `IntegrityCheckResult` | 201 | — | N | deny-all |
| | | _Lanza la verificación de la cadena de hashes del ledger_ | | | | | | |
| `EP-052` | **GET** | `/admin/ledger-access-logs` | `—` | `LedgerAccessLogPage` | 200 | — | N | deny-all |
| | | _Consulta los accesos administrativos al ledger (ADMIN_AUDIT)_ | | | | | | |
| `EP-053` | **GET** | `/admin/payment-audit-entries` | `—` | `PaymentAuditPage` | 200 | — | N | deny-all |
| | | _Consulta el historial de auditoría de pagos sin datos sensibles_ | | | | | | |
| `EP-054` | **GET** | `/admin/bank-transactions` | `—` | `BankTransactionAdminPage` | 200 | — | N | deny-all |
| | | _Lista las transferencias de todos los usuarios con filtros_ | | | | | | |
| `EP-055` | **GET** | `/admin/bank-transactions/{transactionId}` | `—` | `BankTransactionAdminDetail` | 200 | — | N | deny-all |
| | | _Muestra el detalle de una transferencia con su historial de reintentos_ | | | | | | |
| `EP-056` | **POST** | `/admin/bank-transactions/{transactionId}/retries` | `—` | `BankTransactionAdminDetail` | 201 | — | N | deny-all |
| | | _Fuerza el reintento manual de una transferencia fallida_ | | | | | | |
| `EP-057` | **GET** | `/admin/bank-transactions/exports` | `—` | `CsvFile` | 200 | — | N | deny-all |
| | | _Exporta a CSV las transferencias filtradas, sin datos sensibles_ | | | | | | |
| `EP-058` | **POST** | `/admin/bank-statements` | `BankStatementUpload` | `BankStatementImportResult` | 201 | — | N | deny-all |
| | | _Sube manualmente un extracto bancario para conciliarlo_ | | | | | | |
| `EP-059` | **GET** | `/admin/reconciliation-runs` | `—` | `ReconciliationRunPage` | 200 | — | N | deny-all |
| | | _Lista las ejecuciones de conciliación con sus contadores_ | | | | | | |
| `EP-060` | **POST** | `/admin/reconciliation-runs` | `ReconciliationRunRequest` | `ReconciliationRunSummary` | 201 | — | N | deny-all |
| | | _Relanza la conciliación de un proveedor y un periodo_ | | | | | | |
| `EP-061` | **GET** | `/admin/reconciliation-runs/{runId}/corrections` | `—` | `ReconciliationCorrectionList` | 200 | — | N | deny-all |
| | | _Lista las correcciones aplicadas en una ejecución de conciliación_ | | | | | | |
| `EP-062` | **POST** | `/admin/reconciliation-matches/{matchId}/confirmations` | `MatchConfirmationRequest` | `ReconciliationMatchDetail` | 201 | — | N | deny-all |
| | | _Confirma un emparejamiento heurístico de cobro o devolución_ | | | | | | |
| `EP-063` | **GET** | `/admin/reconciliation-exceptions` | `—` | `ReconciliationExceptionPage` | 200 | — | N | deny-all |
| | | _Muestra la bandeja de excepciones de conciliación_ | | | | | | |
| `EP-064` | **PATCH** | `/admin/reconciliation-exceptions/{exceptionId}` | `ExceptionAssignmentRequest` | `ReconciliationExceptionDetail` | 200 | — | N | deny-all |
| | | _Asigna una excepción y la pasa a revisión_ | | | | | | |
| `EP-065` | **POST** | `/admin/reconciliation-exceptions/{exceptionId}/resolutions` | `ExceptionResolutionRequest` | `ReconciliationExceptionDetail` | 201 | — | N | deny-all |
| | | _Cierra una excepción con nota y tipo de resolución (asiento compensatorio si procede)_ | | | | | | |
| `EP-066` | **GET** | `/admin/refund-requests` | `—` | `RefundRequestPage` | 200 | — | N | deny-all |
| | | _Lista las órdenes de reembolso, incluidas las que están en revisión manual_ | | | | | | |
| `EP-067` | **POST** | `/admin/refund-requests/{refundRequestId}/retries` | `RefundRetryRequest` | `RefundRequestDetail` | 201 | — | N | deny-all |
| | | _Reintenta un reembolso en revisión manual por el mismo método_ | | | | | | |
| `EP-068` | **POST** | `/admin/refund-requests/{refundRequestId}/external-resolutions` | `ExternalRefundResolutionRequest` | `RefundRequestDetail` | 201 | — | N | deny-all |
| | | _Marca un reembolso como resuelto externamente con referencia y nota_ | | | | | | |
| `EP-069` | **GET** | `/admin/dunning-cycles` | `—` | `DunningCyclePage` | 200 | — | N | deny-all |
| | | _Lista los ciclos de recobro de tarjeta, PayPal y transferencia_ | | | | | | |
| `EP-070` | **POST** | `/admin/dunning-cycles/{cycleId}/retries` | `—` | `DunningCycleDetail` | 201 | — | N | deny-all |
| | | _Fuerza un reintento de cobro en un ciclo abierto, con traza_ | | | | | | |
| `EP-071` | **GET** | `/admin/retry-policies` | `—` | `RetryPolicyList` | 200 | — | N | deny-all |
| | | _Consulta la política de reintentos activa y su histórico por método y fase_ | | | | | | |
| `EP-072` | **POST** | `/admin/retry-policies/previews` | `RetryPolicyDraft` | `RetryCalendarPreview` | 201 | — | N | deny-all |
| | | _Previsualiza el calendario resultante de una política de reintentos_ | | | | | | |
| `EP-073` | **POST** | `/admin/retry-policies` | `RetryPolicyVersionRequest` | `RetryPolicyVersion` | 201 | — | N | deny-all |
| | | _Crea y activa una nueva versión de la política de reintentos_ | | | | | | |
| `EP-074` | **GET** | `/admin/payment-error-codes` | `—` | `PaymentErrorCodeList` | 200 | — | N | deny-all |
| | | _Consulta el catálogo de códigos de error de pago_ | | | | | | |
| `EP-075` | **POST** | `/admin/payment-error-codes` | `PaymentErrorCodeRequest` | `PaymentErrorCode` | 201 | — | N | deny-all |
| | | _Da de alta la correspondencia entre un código del proveedor y un código canónico_ | | | | | | |
| `EP-076` | **PUT** | `/admin/payment-error-codes/{errorCodeId}` | `PaymentErrorCodeRequest` | `PaymentErrorCode` | 200 | — | N | deny-all |
| | | _Modifica una correspondencia del catálogo de códigos de error_ | | | | | | |
| `EP-077` | **GET** | `/admin/billing-runs` | `—` | `BillingRunPage` | 200 | — | N | deny-all |
| | | _Consulta las ejecuciones del job de facturación periódica_ | | | | | | |
| `EP-078` | **POST** | `/admin/billing-runs` | `—` | `BillingRunSummary` | 201 | — | N | deny-all |
| | | _Relanza manualmente el job de facturación periódica_ | | | | | | |
| `EP-079` | **GET** | `/admin/reports/income` | `—` | `IncomeReport` | 200 | — | N | deny-all |
| | | _Devuelve lo recaudado, los reembolsos y el neto por modalidad en un periodo_ | | | | | | |
| `EP-080` | **GET** | `/admin/reports/users` | `—` | `UserActivityReport` | 200 | — | N | deny-all |
| | | _Devuelve los usuarios activos, las bajas y la tasa de cancelación de un periodo_ | | | | | | |
| `EP-081` | **GET** | `/admin/reports/recurring-unpaid` | `—` | `RecurringUnpaidReport` | 200 | — | N | deny-all |
| | | _Lista los usuarios con dos o más facturas impagadas al cierre del periodo_ | | | | | | |
| `EP-082` | **GET** | `/admin/reports/{reportType}/exports` | `—` | `CsvFile` | 200 | — | N | deny-all |
| | | _Exporta a CSV un reporte con los mismos datos y periodo que en pantalla_ | | | | | | |
| `EP-083` | **GET** | `/admin/payment-reminder-cases` | `—` | `ReminderCasePage` | 200 | — | N | deny-all |
| | | _Lista los casos de aviso de impago por usuario o por factura_ | | | | | | |
| `EP-084` | **GET** | `/admin/payment-reminder-cases/{caseId}` | `—` | `ReminderCaseDetail` | 200 | — | N | deny-all |
| | | _Muestra los hitos, intentos y eventos de entrega de un caso de aviso_ | | | | | | |
| `EP-085` | **GET** | `/admin/reminder-detector-runs` | `—` | `ReminderDetectorRunPage` | 200 | — | N | deny-all |
| | | _Consulta las ejecuciones del detector de impagos_ | | | | | | |
| `EP-086` | **POST** | `/admin/reminder-detector-runs` | `—` | `ReminderDetectorRunSummary` | 201 | — | N | deny-all |
| | | _Relanza manualmente el detector de impagos_ | | | | | | |
| `EP-087` | **GET** | `/admin/payment-reminder-schedules` | `—` | `ReminderScheduleVersionList` | 200 | — | N | deny-all |
| | | _Consulta el calendario de avisos activo y su histórico de versiones_ | | | | | | |
| `EP-088` | **POST** | `/admin/payment-reminder-schedules/impact-previews` | `ReminderScheduleDraft` | `ReminderImpactPreview` | 201 | — | N | deny-all |
| | | _Previsualiza el impacto de un cambio en el calendario, los canales o el tope de avisos_ | | | | | | |
| `EP-089` | **POST** | `/admin/payment-reminder-schedules` | `ReminderScheduleVersionRequest` | `ReminderScheduleVersion` | 201 | — | N | deny-all |
| | | _Confirma una nueva versión del calendario y del tope de avisos_ | | | | | | |
| `EP-090` | **GET** | `/admin/smtp-configs` | `—` | `SmtpConfigView` | 200 | — | N | deny-all |
| | | _Consulta la configuración SMTP activa y su historial, sin el secreto_ | | | | | | |
| `EP-091` | **POST** | `/admin/smtp-configs/validations` | `SmtpConfigDraft` | `SmtpValidationResult` | 201 | — | N | deny-all |
| | | _Valida la conexión SMTP de un borrador sin guardarlo_ | | | | | | |
| `EP-092` | **POST** | `/admin/smtp-configs` | `SmtpConfigVersionRequest` | `SmtpConfigView` | 201 | — | N | deny-all |
| | | _Guarda la configuración SMTP validada como nueva versión activa_ | | | | | | |
| `EP-093` | **GET** | `/admin/email-templates` | `—` | `EmailTemplateList` | 200 | — | N | deny-all |
| | | _Lista las plantillas predefinidas de email de impago_ | | | | | | |
| `EP-094` | **PUT** | `/admin/email-templates/{templateKey}` | `EmailTemplateUpdateRequest` | `EmailTemplateVersion` | 200 | — | N | deny-all |
| | | _Edita el asunto y el cuerpo de una plantilla de email y crea una versión nueva_ | | | | | | |
| `EP-095` | **POST** | `/admin/email-templates/{templateKey}/restorations` | `TemplateRestoreRequest` | `EmailTemplateVersion` | 201 | — | N | deny-all |
| | | _Restaura el texto predefinido de una plantilla como versión nueva_ | | | | | | |
| `EP-096` | **POST** | `/admin/email-templates/{templateKey}/test-sends` | `EmailTemplateTestRequest` | `TestSendResult` | 201 | — | N | deny-all |
| | | _Envía un email de prueba al correo del ADMIN con valores ficticios_ | | | | | | |
| `EP-097` | **GET** | `/admin/sms-configs` | `—` | `SmsConfigView` | 200 | — | N | deny-all |
| | | _Consulta la configuración SMS activa y su histórico, sin secretos_ | | | | | | |
| `EP-098` | **POST** | `/admin/sms-configs/validations` | `SmsConfigDraft` | `SmsValidationResult` | 201 | — | N | deny-all |
| | | _Valida la conexión con el proveedor de SMS sin enviar ningún SMS_ | | | | | | |
| `EP-099` | **POST** | `/admin/sms-configs` | `SmsConfigVersionRequest` | `SmsConfigView` | 201 | — | N | deny-all |
| | | _Guarda la configuración SMS validada como nueva versión activa_ | | | | | | |
| `EP-100` | **GET** | `/admin/sms-dispatches` | `—` | `SmsDispatchPage` | 200 | — | N | deny-all |
| | | _Consulta la cola de envío de SMS con el destino enmascarado_ | | | | | | |
| `EP-101` | **GET** | `/admin/sms-templates` | `—` | `SmsTemplateList` | 200 | — | N | deny-all |
| | | _Lista las plantillas predefinidas de SMS de impago_ | | | | | | |
| `EP-102` | **PUT** | `/admin/sms-templates/{templateCode}` | `SmsTemplateUpdateRequest` | `SmsTemplateVersion` | 200 | — | N | deny-all |
| | | _Edita una plantilla SMS y crea una versión nueva_ | | | | | | |
| `EP-103` | **POST** | `/admin/sms-templates/{templateCode}/test-sends` | `SmsTemplateTestRequest` | `TestSendResult` | 201 | — | N | deny-all |
| | | _Envía un SMS de prueba al móvil del ADMIN con valores ficticios_ | | | | | | |
| `EP-104` | **GET** | `/admin/email-verification-resend-runs` | `—` | `ResendRunPage` | 200 | — | N | deny-all |
| | | _Consulta las ejecuciones del job de reenvío de confirmaciones_ | | | | | | |
| `EP-105` | **GET** | `/admin/retention-runs` | `—` | `RetentionRunPage` | 200 | — | N | deny-all |
| | | _Consulta las ejecuciones de retención, anonimización y derecho al olvido_ | | | | | | |
| `EP-106` | **POST** | `/admin/retention-runs` | `RetentionRunRequest` | `RetentionRunSummary` | 201 | — | N | deny-all |
| | | _Lanza manualmente un proceso de retención o de derecho al olvido_ | | | | | | |
| `EP-107` | **POST** | `/admin/nfc-credentials/{credentialId}/revocations` | `NfcCredentialRevocationRequest` | `NfcCredentialDetail` | 201 | — | N | deny-all |
| | | _Revoca la credencial NFC de un usuario con motivo y comentario auditados_ | | | | | | |
| `EP-108` | **GET** | `/admin/access-attempts` | `—` | `AccessAttemptPage` | 200 | — | N | deny-all |
| | | _Consulta los intentos de acceso NFC filtrados por usuario, lector, decisión y periodo_ | | | | | | |
| `EP-109` | **GET** | `/admin/users/{userId}/nfc-credentials` | `—` | `UserNfcAccessDetail` | 200 | — | N | deny-all |
| | | _Muestra la credencial NFC de un usuario y sus últimos intentos de acceso_ | | | | | | |
| `EP-110` | **GET** | `/admin/provider-events` | `—` | `ProviderEventPage` | 200 | — | N | deny-all |
| | | _Consulta las notificaciones recibidas de los proveedores y su estado de procesamiento_ | | | | | | |
| `EP-111` | **POST** | `/webhooks/card-gateway-events` | `CardGatewayWebhookEvent` | `WebhookAck` | 201 | — | N | deny-all |
| | | _Recibe y valida por firma los eventos de estado del gateway de tarjeta_ | | | | | | |
| `EP-112` | **POST** | `/webhooks/paypal-events` | `PayPalWebhookEvent` | `WebhookAck` | 201 | — | N | deny-all |
| | | _Recibe y valida por firma los eventos de cobros y reembolsos de PayPal_ | | | | | | |
| `EP-113` | **POST** | `/webhooks/email-delivery-events` | `EmailDeliveryEvent` | `WebhookAck` | 201 | — | N | deny-all |
| | | _Recibe el estado de entrega de los emails del proveedor_ | | | | | | |
| `EP-114` | **POST** | `/webhooks/sms-delivery-reports` | `SmsDeliveryReport` | `WebhookAck` | 201 | — | N | deny-all |
| | | _Recibe los informes de entrega (DLR) de los SMS_ | | | | | | |
| `EP-115` | **POST** | `/access-decisions` | `AccessDecisionRequest` | `AccessDecision` | 201 | — | N | deny-all |
| | | _Verifica la credencial NFC presentada al lector y decide el acceso según la suscripción_ | | | | | | |

Disciplina (api-contract):
1. Path y verbo **literales** del contrato (`/membership-plans`, no `/plans/`; `PUT`, no `PATCH` si el contrato dice PUT).
2. La base pública de la API es **`servers[0].url` del `openapi.yaml`** (p. ej. `/api`): monta los routers de forma que la URL pública sea `base + path` EXACTAMENTE. No inventes otra base ni añadas versiones (`/v1`) que el contrato no traiga: el cliente concatena `base + path` y cualquier otro prefijo le devuelve 404.
3. Status HTTP de la columna Status (POST→201, DELETE→204, resto→200) salvo que `openapi.yaml` declare otro. Los de **error** son los de la columna Errores y su tabla: ni uno más, ni uno menos, ni otro `code` — si necesitas un error que el contrato no declara, devuelve el más cercano del catálogo y **repórtalo como health check `Warning` con `check: api-contract`**.
4. Prefijos de montaje (`include_router`) deben hacer que la URL pública coincida con `base + path` del contrato.
5. Los schemas CON campos (tabla de arriba) son LEY: mismos nombres, tipos y obligatoriedad en tus DTO. Los que aún no tienen campos son gérmenes: rellénalos con el modelo real; **no** reescribas `openapi.yaml` para legitimar un path inventado.
6. Si el DoD te pide un comportamiento que ningún endpoint de la tabla cubre (desarchivar, restaurar, desmarcar…), NO lo resuelvas inventando una ruta: entrégalo con el endpoint que más se le parezca y **repórtalo como health check `Warning` con `check: api-contract`** para que arquitectura lo añada. Una ruta inventada es invisible para el cliente.
7. Si el repo trae `.mind/contract-pending.json` (PR #0), **quita de `pending` los EP que implementas en este mismo PR**: el test de contrato del repo (`tests/contract/`) deja de exonerarlos y pasa a exigirlos, y el runtime comprueba que no dejas los tuyos pendientes. No quites los de otras tareas.
7. Monta el guard con los códigos de la columna Roles. No inventes roles. Si Public=N y Roles=`deny-all`, NO expongas la ruta: avísalo en el PR.

## Contrato de salida del arquetipo

> El repo se genera desde el arquetipo `event` (ArqRef MAPFRE). Produce EXACTAMENTE ficheros con la estructura, rutas y HERRAMIENTA de este arquetipo, imitando el esqueleto/ejemplos de abajo. NO improvises otra herramienta ni otra disposición (p.ej. si el arquetipo usa Liquibase, NO uses Flyway). Extiende el esqueleto; no lo reinventes.

**Raíz del proyecto**: el código va bajo `sources/`, `local/`, `apps/`, `libs/`, `src/` — donde el arquetipo pone el suyo. Si el repo está vacío y tienes que andamiarlo, respeta esa raíz en vez de elegir una nueva: el resto del aprovisionamiento (pipelines del arquetipo, verificación de build, empaquetado) espera encontrarlo ahí.

### Estructura del proyecto (del arquetipo)
```
├── .gitignore
├── .github
│   ├── workflows
│   │   ├── merge-commit.yml          # Workflow para gestión de merges
│   │   ├── pull-request.yml          # Workflow corporativo
│
├── README.md                        # Documentación del repositorio
├── CHANGELOG.md                     # Registro de cambios
├── CONTRIBUTING.md                   # Guía para contribuir al proyecto
│
├── .config/
│   └── schemas/
│       ├── event-definition.schema.json         # JSON Schema para validar events/*.json
│       └── component-definition.schema.json     # JSON Schema para validar components/*.json
│
├── sources                           # Definiciones de APIs y contratos
│   ├── schemas
│   │       └── sample_event.avsc         (Definicion Shema Registry)
│   ├── events
│   │       └── sample_event.json         (Definicion Eventos, Topic)
│   ├── components
│   │       └── sample_component.json     (Definicion de Productores, Consumidores)
│
├── tests/
│   ├── event-validation.test.js                 # Valida todos los events/*.json contra su JSON Schema
│   ├── component-validation.test.js             # Valida todos los components/*.json
│   └── schema-validation.test.js                # Valida que los .avsc son esquemas Avro válidos

```

---

### Esqueleto y ejemplos (imítalos exactamente)
#### `sources/events/README.md`
```md
Se dejaran las definiciones de los EVENTOS en la carpeta `sources/` y se seguirán las convenciones de nombres y estructura para facilitar su identificación y uso.
```

## Guía del programador del proyecto (convenciones — T.7, aprobada)

**Precedencia (handbook-filter):** si esta guía choca con el **contrato ArqRef** o el **DoD de ESTA tarea**, ganan ArqRef y el DoD. Solo se incluyen convenciones del stack de esta TSK; se omiten slices de otros lenguajes/frameworks (p. ej. Angular HttpClient en una TSK React, FastAPI en un SPA).

### Librerías del handbook (pines — dependency-pins)
Usa estas coordenadas/versiones en el manifiesto del host; no improvises latest sin pin.
- **Alembic** `>=1.14,<2` [backend] · `alembic`
- **argon2-cffi** `>=23.1` [backend] · `argon2-cffi`
- **PyJWT** `>=2.10,<3` [backend] · `pyjwt`
- **cryptography** `>=44` [backend] · `cryptography`
- **httpx** `>=0.28,<1` [backend] · `httpx`
- **tenacity** `>=9.0,<10` [backend] · `tenacity`
- **pybreaker** `>=1.2,<2` [backend] · `pybreaker`
- **APScheduler 3.x** `>=3.11,<4` [backend] · `apscheduler`
- **structlog** `>=24.4` [backend] · `structlog`
- **phonenumbers** `>=8.13` [backend] · `phonenumbers`
- **Motor de políticas propio (app.core.policies)** `interno` [backend]
- **Oracle Database en Amazon RDS for Oracle (Multi-AZ)** `Mínimo 19c. La versión exacta está pendiente porque MAR2 no la fija; la edición y la licencia también están pendientes (coste no incluido en la KB).` [bbdd]
- **openapi-typescript** `>=7.4,<8` [api] · `openapi-typescript`
- **oasdiff** `>=1.10` [api] · `github.com/oasdiff/oasdiff`
- **Outbox transaccional propio (tabla OPS.event_outbox + relay en worker)** `interno` [messaging]
- **AsyncAPI CLI** `>=2.0` [messaging] · `@asyncapi/cli`
- **boto3 (S3, KMS, Secrets Manager)** `>=1.35,<2` [storage] · `boto3`
- **Capacitor (solo app NFC ARC-019)** `>=7,<8` [frontend] · `@capacitor/core`
- **Testcontainers (Oracle Free)** `>=4.8,<5` [tests] · `testcontainers`
- **respx** `>=0.21` [tests] · `respx`
- **time-machine** `>=2.16` [tests] · `time-machine`
- **ruff + mypy** `ruff >=0.8; mypy >=1.13 (modo strict)` [tests] · `ruff`
- **Playwright** `>=1.48` [tests] · `@playwright/test`
- **Lighthouse CI** `>=0.14` [tests] · `@lhci/cli`
- **k6** `>=0.54` [tests] · `go.k6.io/k6`
- **Terraform + proveedor hashicorp/aws** `Terraform >=1.9; aws provider >=5.70,<6` [infra]
- **OpenTelemetry SDK + exportador OTLP** `SDK >=1.28,<2` [observability] · `opentelemetry-sdk`
- **sentry-sdk** `>=2.19,<3` [observability] · `sentry-sdk`
- **Amazon Managed Prometheus + Alertmanager, Amazon Managed Grafana, Loki y Tempo en ECS con backend S3** `Servicios gestionados / Loki 3.x / Tempo 2.x` [observability]

### Convenciones
- **[BBDD Oracle] Tablas y columnas en snake_case SIN comillas (Oracle las pliega a mayúsculas). Tablas en plural, identificadores de 30 caracteres como máximo (válido para 19c) y nunca palabras reservadas de Oracle como nombre (user, comment, date, size, mode, level, number, order, access, file, session, uid, resource). Cada módulo usa su esquema (IDENTITY, BILLING, PAYMENTS, OPS) declarado en __table_args__. Las FK solo existen dentro del mismo esquema; las referencias a otro módulo son columnas Uuid sin FK. Un test de metadatos en CI falla si algún identificador supera 30 caracteres.** — Los identificadores entre comillas obligan a citarlos siempre. Las palabras reservadas rompen el DDL. Las FK entre esquemas requieren GRANT REFERENCES y acoplan módulos (ADR-005).
  - Ejemplo correcto: `__tablename__ = "subscription_cancellations"
revoke_comment: Mapped[str | None] = mapped_column(String(500))`
  - Ejemplo incorrecto (evítalo): `__tablename__ = "SubscriptionCancellation"
comment: Mapped[str] = mapped_column(String(500))  # COMMENT es palabra reservada en Oracle`

### Matriz de compatibilidad de tipos
- `datetime aware UTC (columna UtcDateTime → TIMESTAMP(6))` en `oracle`: **OK** — Tipo canónico para instantes. Se guarda en UTC sin zona y se devuelve aware UTC.
- `datetime naive (datetime.now() / utcnow())` en `oracle`: **PROHIBIDO** — Ambiguo respecto a la zona del contenedor. UtcDateTime lo rechaza con ValueError.
- `date (sa.Date → DATE)` en `oracle`: **OK** — Para fechas de negocio en Europe/Madrid. El DATE de Oracle incluye 00:00:00; nunca se guardan horas en columnas de fecha.
- `UUID generado en BD (SYS_GUID() / RAW(16) como default)` en `oracle`: **PROHIBIDO** — El id debe conocerse antes del commit (outbox, idempotencia). Además no es portable.
- `int en céntimos (sa.Integer / sa.BigInteger → NUMBER)` en `oracle`: **OK** — Todos los importes '*_cents' y contadores.
- `float para importes (sa.Float → BINARY_DOUBLE/FLOAT)` en `oracle`: **PROHIBIDO** — Errores de redondeo en prorrateos y en el hash del ledger.
- `decimal.Decimal (sa.Numeric(p, s) → NUMBER(p,s))` en `oracle`: **OK** — Solo porcentajes, por ejemplo tax_rate NUMBER(5,4) y cancellation_rate.
- `bool (sa.Boolean → NUMBER(1) con CHECK)` en `oracle`: **OK** — Se usa el tipo no nativo; el BOOLEAN nativo requiere 23ai y la versión no está fijada.
- `str corto (sa.String(n) → VARCHAR2(n))` en `oracle`: **OK** — n ≤ 4000 bytes. '' se guarda como NULL. Para texto con acentos, n se dimensiona en caracteres con holgura (NLS_LENGTH_SEMANTICS=CHAR en el esquema).
- `str largo / CLOB (sa.Text → CLOB)` en `oracle`: **OK** — Para payloads saneados, plantillas y notas largas. Prohibido en WHERE de igualdad, ORDER BY, GROUP BY y UNIQUE.
- `bytes / BLOB (sa.LargeBinary → BLOB)` en `oracle`: **OK** — Solo para binarios. Los ficheros bancarios van a S3 (ARC-026), no a la BD. Las columnas cifradas usan EncryptedString (VARCHAR2 base64), no BLOB.
- `StrEnum (sa.Enum(native_enum=False, create_constraint=True) → VARCHAR2 + CHECK)` en `oracle`: **OK** — Todos los estados (invoice_status, card_status…). Ampliar valores exige una migración del CHECK.

## Modelo de datos a respetar (diseñado en arquitectura — T.5, schema-names)

> Nombres FÍSICOS canónicos. Úsalos en modelos, DTOs, queries y contratos. **PROHIBIDO** traducir (`titulo`→`title`, `contenido`→`content`, `estado` `publicada|borrador`→`published|draft`). La migración ya (o va a) crear estas entidades — no improvises un esquema paralelo.

**Inventario T.5 (42):** `cat_roles`, `users`, `user_sessions`, `password_reset_tokens`, `email_verification_tokens`, `audit_log`, `job_runs`, `cat_subscription_plans`, `subscriptions`, `subscription_plan_changes`, `billing_cycles`, `invoice_series_counters`, `invoices`, `subscription_cancellations`, `payment_methods`, `payment_transactions`, `transaction_ledger`, `transaction_events`, `refund_requests`, `refund_transactions`, `dunning_cycles`, `cat_retry_policies`, `cat_payment_error_codes`, `gateway_webhook_events`, `reconciliation_exceptions`, `bank_statement_imports`, `bank_statement_entries`, `event_outbox`, `cat_payment_reminder_schedule`, `payment_reminder_cases`, `payment_reminder_steps`, `notification_attempts`, `notification_delivery_events`, `cat_sms_providers`, `notification_provider_configs`, `provider_config_validations`, `notification_templates`, `template_test_sends`, `sms_dispatch_queue`, `nfc_readers`, `nfc_credentials`, `access_attempts`

**Catálogos (`data_kind = catalog`): `cat_roles`, `cat_subscription_plans`, `cat_retry_policies`, `cat_payment_error_codes`, `cat_payment_reminder_schedule`, `cat_sms_providers`, `notification_templates`, `nfc_readers`.** Los siembra la migración: LÉELOS de la base de datos (no hardcodees sus valores en enums ni en el front) y, si al arrancar están vacíos, es un defecto de la tarea de datos — repórtalo como health check `Warning` con `check: seeds`, no lo tapes con valores por defecto.

- **Motor de datos del proyecto: Oracle** (capa `db` del stack, aprobada en T.2/T.3). TODO el DDL y el DML que escribas debe ser válido EN ESE MOTOR y en su dialecto. Nada de tipos ni sintaxis de otros motores: si un tipo o construcción no existe en Oracle, usa su equivalente nativo. Y no te fíes de tu criterio: APLICA el changelog contra el motor real del entorno de prueba antes de entregar (ver «Entorno de prueba de esta sesión»).

### ARC-109 · `cat_roles` (table) · **catalog**
Catálogo de roles de la plataforma que se usan para autorizar cada operación (cat_roles).
**Columnas:**
- `role_code` VARCHAR(20) [PK, NOT NULL] — PK; semilla: USUARIO | ADMIN | ADMIN_AUDIT | SISTEMA [gap: matriz rol-permiso del cliente]
- `description` VARCHAR(255) [NOT NULL]
- `is_active` TINYINT(1) [NOT NULL] — default 1

### ARC-110 · `users` (table) · **transactional**
Perfil del usuario: identidad, datos personales, credencial con hash, estado de la cuenta y control de bloqueo.
**Columnas:**
- `user_id` CHAR(36) [PK, NOT NULL] — PK UUID generado por el sistema
- `first_name` VARCHAR(100) [NOT NULL] — trim; máx. 100
- `last_name` VARCHAR(100) [NOT NULL] — trim; máx. 100
- `age` SMALLINT [NOT NULL] — CHECK 18-120 (REQ-008) [gap REQ-001: rango en el registro]; ambigüedad edad frente a fecha de nacimiento
- `address` VARCHAR(255) [NOT NULL] — máx. 255 (REQ-001); REQ-008 indica 100 [contradicción]
- `email` VARCHAR(254) [NOT NULL] — UNIQUE; normalizado en minúsculas; RFC 5322 básico
- `nick` VARCHAR(30) [NOT NULL] — UNIQUE case-insensitive; 3-30 caracteres [a-z0-9_]; inmutable
- `phone_number` VARCHAR(20) [NOT NULL] — mínimo 9 dígitos; se normaliza a E.164 (+34 por defecto) para SMS [gap: formato]
- `password_hash` VARCHAR(255) [NOT NULL] — bcrypt/Argon2 con salt; nunca en texto plano
- `password_updated_at` DATETIME(6) — UTC
- `role_code` VARCHAR(20) [NOT NULL, FK→cat_roles] — default USUARIO; un cambio de rol revoca las sesiones
- `account_status` VARCHAR(30) [NOT NULL] — enum: PENDING_EMAIL_VALIDATION | ACTIVE | CANCELLED | ANONYMIZED
- `is_active` TINYINT(1) [NOT NULL] — solo puede operar con is_active=1 y deleted_at nulo
- `email_verified` TINYINT(1) [NOT NULL] — default 0
- `email_verified_at` DATETIME(6)
- `failed_login_attempts` INT [NOT NULL] — default 0; umbral configurable [gap]
- `last_failed_login_at` DATETIME(6)
- `locked_until` DATETIME(6) — NULL tras un login correcto o un desbloqueo por ADMIN
- `last_login_at` DATETIME(6)
- `user_pseudonym` VARCHAR(64) — seudónimo irreversible para el derecho al olvido (REQ-078)
- `created_at` DATETIME(6) [NOT NULL] — fecha de registro
- `updated_at` DATETIME(6) [NOT NULL]
- `deleted_at` DATETIME(6) — baja lógica de la cuenta
**Relaciones:**
- → `cat_roles`: N:1 tiene asignado el rol

### ARC-111 · `user_sessions` (table) · **transactional**
Sesiones emitidas tras el login, con su caducidad y su revocación.
**Columnas:**
- `session_id` CHAR(36) [PK, NOT NULL] — PK UUID; uno nuevo en cada renovación
- `user_id` CHAR(36) [NOT NULL, FK→users] — admite varias sesiones activas por usuario
- `role_code` VARCHAR(20) [NOT NULL, FK→cat_roles]
- `session_token_hash` CHAR(64) [NOT NULL] — UNIQUE; hash SHA-256; nunca el token en claro
- `issued_at` DATETIME(6) [NOT NULL]
- `expires_at` DATETIME(6) [NOT NULL] — CHECK expires_at > issued_at [gap: duración]
- `revoked_at` DATETIME(6) — no puede ser anterior a issued_at
- `revocation_reason` VARCHAR(20) — enum: LOGOUT | PASSWORD_CHANGED | USER_CANCELLED | ADMIN_ACTION | EXPIRED
- `revoked_by_id` CHAR(36) [FK→users] — titular o ADMIN
- `login_ip` VARCHAR(45) — IPv4/IPv6
- `user_agent` VARCHAR(255)
**Relaciones:**
- → `users`: N:1 sesión del usuario (y revocada por titular o ADMIN)
- → `cat_roles`: N:1 rol de la sesión

### ARC-112 · `password_reset_tokens` (table) · **transactional**
Tokens de un solo uso para recuperar la contraseña, válidos 15 minutos.
**Columnas:**
- `token_id` CHAR(36) [PK, NOT NULL] — PK
- `user_id` CHAR(36) [NOT NULL, FK→users] — como máximo un token activo por usuario
- `token_hash` CHAR(64) [NOT NULL] — UNIQUE; SHA-256; el token en claro nunca se guarda
- `created_at` DATETIME(6) [NOT NULL] — UTC
- `expires_at` DATETIME(6) [NOT NULL] — = created_at + 15 min
- `consumed_at` DATETIME(6) — se informa en la misma transacción que actualiza password_hash
- `invalidated_at` DATETIME(6) — se informa cuando se emite un token nuevo
**Relaciones:**
- → `users`: N:1 token de recuperación del usuario

### ARC-113 · `email_verification_tokens` (table) · **transactional**
Tokens de confirmación de email (24 h, un solo uso) junto con su estado de envío.
**Columnas:**
- `token_id` CHAR(36) [PK, NOT NULL] — PK
- `user_id` CHAR(36) [NOT NULL, FK→users] — como máximo un token vigente por usuario (bloqueo de fila)
- `token_hash` CHAR(64) [NOT NULL] — UNIQUE; SHA-256
- `issue_reason` VARCHAR(20) [NOT NULL] — enum: REGISTRATION | MANUAL_RESEND | AUTO_RESEND
- `send_status` VARCHAR(10) [NOT NULL] — enum: PENDING | SENT | FAILED
- `created_at` DATETIME(6) [NOT NULL]
- `expires_at` DATETIME(6) [NOT NULL] — = created_at + 24 h
- `used_at` DATETIME(6)
- `invalidated_at` DATETIME(6)
**Relaciones:**
- → `users`: N:1 token de confirmación del usuario

### ARC-114 · `audit_log` (table) · **event_log**
Auditoría append-only de seguridad, operaciones de pago, accesos de ADMIN, exportaciones y cambios de configuración.
**Columnas:**
- `audit_id` CHAR(36) [PK, NOT NULL] — PK; sin UPDATE ni DELETE desde la aplicación; retención de 7 años
- `audit_category` VARCHAR(20) [NOT NULL] — enum: SECURITY | PAYMENT | LEDGER_ACCESS | ADMIN_ACTION | CONFIG_CHANGE | NFC; LEDGER_ACCESS solo lo lee ADMIN_AUDIT
- `action` VARCHAR(40) [NOT NULL] — p. ej. LOGIN_FAILED, ACCOUNT_LOCKED, AUTH, CAPTURE, REFUND, LIST_QUERY, DETAIL_VIEW, EXPORT_CSV, MANUAL_RETRY, EXCEPTION_RESOLVE, PAYMENT_METHOD_DELETED
- `actor_type` VARCHAR(10) [NOT NULL] — enum: USER | ADMIN | SYSTEM
- `actor_id` CHAR(36) [FK→users]
- `actor_role` VARCHAR(20) [FK→cat_roles]
- `target_user_id` CHAR(36) [FK→users] — usuario afectado o consultado
- `target_entity` VARCHAR(50) — tabla o recurso afectado
- `target_id` VARCHAR(100) — p. ej. ledger_id, payment_id o session_id
- `login_identifier_masked` VARCHAR(255) — enmascarado; la contraseña nunca
- `status_before` VARCHAR(30)
- `status_after` VARCHAR(30)
- `amount_cents` INT
- `report_type` VARCHAR(20) — enum: INCOME | USERS | RECURRING_UNPAID
- `period_start` DATETIME(6)
- `period_end` DATETIME(6)
- `filters_applied` JSON — filtros saneados; nunca los resultados
- `result_count` INT — filas devueltas o exportadas
- `previous_values` JSON — secretos solo como cambiado o sin cambios
- `new_values` JSON — secretos solo como cambiado o sin cambios
- `change_reason` VARCHAR(500) — obligatorio en CONFIG_CHANGE (10-500 caracteres)
- `error_summary` VARCHAR(500) — sin tokens, PAN ni payload completo
- `route` VARCHAR(255) — ruta en los rechazos 401 y 403
- `ip_address` VARCHAR(45) — se anonimiza a los 24 meses (REQ-078)
- `user_agent` VARCHAR(255)
- `occurred_at` DATETIME(6) [NOT NULL] — UTC
**Relaciones:**
- → `users`: N:1 actor y usuario afectado
- → `cat_roles`: N:1 rol del actor

### ARC-115 · `job_runs` (table) · **event_log**
Registro de las ejecuciones de los jobs programados (facturación, detector de impagos, reenvíos, conciliación, integridad, retención, caducidad de tarjetas y dunning).
**Columnas:**
- `run_id` CHAR(36) [PK, NOT NULL] — PK
- `job_type` VARCHAR(40) [NOT NULL] — enum: BILLING | REMINDER_DETECTOR | EMAIL_VERIFICATION_RESEND | GATEWAY_RECONCILIATION | PROVIDER_RECONCILIATION | INTEGRITY_CHECK | RETENTION | CARD_EXPIRY | DUNNING; una sola instancia en ejecución por tipo (lock en BD)
- `run_subtype` VARCHAR(30) — RETENTION: ANONYMIZE | PURGE | RIGHT_TO_BE_FORGOTTEN
- `provider_name` VARCHAR(30) — PAYPAL | CARD_GATEWAY; lock por proveedor y periodo
- `scope` VARCHAR(100) — ámbito verificado o tratado
- `period_from` DATE — <= period_to
- `period_to` DATE — nunca futuro
- `run_status` VARCHAR(10) [NOT NULL] — enum: RUNNING | OK | PARTIAL | FAILED
- `executed_by` VARCHAR(10) [NOT NULL] — enum: SYSTEM | ADMIN
- `triggered_by_admin_id` CHAR(36) [FK→users] — solo en relanzamiento manual
- `scanned_count` INT — candidatos seleccionados
- `processed_count` INT — facturas creadas, reenvíos o registros afectados
- `matched_count` INT
- `corrected_count` INT
- `escalated_count` INT
- `discrepancies_count` INT
- `errors_count` INT — en INTEGRITY_CHECK equivale a broken_records
- `last_processed_ledger_id` CHAR(36) — obligatorio si RETENTION queda en PARTIAL
- `error_summary` VARCHAR(500)
- `started_at` DATETIME(6) [NOT NULL]
- `finished_at` DATETIME(6) — >= started_at
**Relaciones:**
- → `users`: N:1 relanzada por ADMIN

### ARC-116 · `cat_subscription_plans` (table) · **catalog**
Catálogo versionado de modalidades de suscripción con periodo, precio, IVA y orden de presentación.
**Columnas:**
- `plan_id` INT [PK, NOT NULL] — PK autoincremental
- `plan_code` VARCHAR(20) [NOT NULL] — semilla: MENSUAL | TRIMESTRAL | ANUAL; UNIQUE (plan_code, valid_from); nombre del catálogo en conflicto con cat_modalidades_pago
- `display_name` VARCHAR(50) [NOT NULL] — se usa en el concepto «Cuota GymUsers [modalidad]»
- `billing_period_months` TINYINT [NOT NULL] — 1 | 3 | 12
- `billing_period_days` SMALLINT [NOT NULL] — 30 | 90 | 365 [contradicción REQ-098 frente a REQ-111, días o meses]
- `price_cents` INT [NOT NULL] — semilla: 4500 | 12000 | 42000
- `tax_rate` DECIMAL(5,2) [NOT NULL] — [gap: tipo de IVA aplicable]
- `is_active` TINYINT(1) [NOT NULL]
- `display_order` TINYINT [NOT NULL]
- `is_preselected` TINYINT(1) [NOT NULL] — 1 solo en ANUAL
- `valid_from` DATE [NOT NULL] — se factura con el precio vigente en issue_date
- `valid_to` DATE

### ARC-117 · `subscriptions` (table) · **transactional**
Suscripción del usuario: modalidad, método de pago, estado, precio congelado y calendario de facturación.
**Columnas:**
- `subscription_id` CHAR(36) [PK, NOT NULL] — PK
- `user_id` CHAR(36) [NOT NULL, FK→users] — siempre el usuario de la sesión; como máximo una ACTIVE por usuario
- `plan_id` INT [NOT NULL, FK→cat_subscription_plans] — modalidad vigente
- `payment_method_id` CHAR(36) [NOT NULL, FK→payment_methods] — debe pertenecer al mismo usuario
- `subscription_status` VARCHAR(20) [NOT NULL] — enum: ACTIVE | CANCELLED | SUSPENDED [gap: semántica de SUSPENDED]
- `is_unpaid` TINYINT(1) [NOT NULL] — default 0; se marca cuando el dunning cierra en UNPAID; no suspende el acceso
- `price_cents_snapshot` INT [NOT NULL] — precio congelado en el alta
- `idempotency_key` VARCHAR(64) [NOT NULL] — UNIQUE; un alta por clave
- `started_at` DATETIME(6) [NOT NULL] — fecha de alta
- `anchor_date` DATE [NOT NULL] — fecha ancla del calendario [contradicción: fecha de alta o de última factura]
- `current_period_start` DATE [NOT NULL]
- `current_period_end` DATE [NOT NULL]
- `next_billing_date` DATE — NULL tras la baja; último día del mes si el día no existe
- `auto_renew` TINYINT(1) [NOT NULL] — 0 tras la baja
- `cancelled_at` DATETIME(6) — inmutable una vez informado
- `cancellation_effective_date` DATE — no se emiten facturas de periodos posteriores
- `created_at` DATETIME(6) [NOT NULL]
- `updated_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `users`: N:1 suscripción del usuario
- → `cat_subscription_plans`: N:1 modalidad contratada
- → `payment_methods`: N:1 se cobra con el método de pago

### ARC-118 · `subscription_plan_changes` (table) · **transactional**
Cambios de modalidad programados para la siguiente fecha de ciclo, sin prorrateo.
**Columnas:**
- `change_id` CHAR(36) [PK, NOT NULL] — PK
- `subscription_id` CHAR(36) [NOT NULL, FK→subscriptions] — como máximo un cambio PENDING por suscripción
- `from_plan_id` INT [NOT NULL, FK→cat_subscription_plans]
- `to_plan_id` INT [NOT NULL, FK→cat_subscription_plans] — distinta de la actual y activa
- `effective_date` DATE [NOT NULL] — = siguiente fecha de ciclo; anulable hasta la víspera
- `pending_change_status` VARCHAR(20) [NOT NULL] — enum: PENDING | CANCELLED | SUPERSEDED | APPLIED [inferido]
- `requested_by_id` CHAR(36) [NOT NULL, FK→users] — titular o ADMIN
- `requested_at` DATETIME(6) [NOT NULL]
- `resolved_at` DATETIME(6)
**Relaciones:**
- → `subscriptions`: N:1 cambio de la suscripción
- → `cat_subscription_plans`: N:1 modalidad origen y destino
- → `users`: N:1 solicitado por titular o ADMIN

### ARC-119 · `billing_cycles` (table) · **transactional**
Ciclos de facturación de cada suscripción, con su periodo de servicio e importe.
**Columnas:**
- `billing_cycle_id` CHAR(36) [PK, NOT NULL] — PK
- `subscription_id` CHAR(36) [NOT NULL, FK→subscriptions] — como máximo un ciclo OPEN; sin solapes
- `cycle_number` INT [NOT NULL] — UNIQUE (subscription_id, cycle_number)
- `plan_id` INT [NOT NULL, FK→cat_subscription_plans] — modalidad aplicada en el ciclo
- `period_start` DATE [NOT NULL]
- `period_end` DATE [NOT NULL] — = next_billing_date - 1 día
- `next_billing_date` DATE [NOT NULL]
- `amount_cents` INT [NOT NULL]
- `cycle_status` VARCHAR(10) [NOT NULL] — enum: OPEN | CLOSED
- `created_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `subscriptions`: N:1 ciclo de la suscripción
- → `cat_subscription_plans`: N:1 modalidad aplicada en el ciclo

### ARC-120 · `invoice_series_counters` (table) · **transactional**
Contador correlativo de la serie anual de facturas (GU-AAAA-NNNNNN).
**Columnas:**
- `series_year` SMALLINT [PK, NOT NULL] — PK; fila creada al emitir la primera factura del año
- `last_number` INT [NOT NULL] — SELECT ... FOR UPDATE en la transacción de emisión; sin huecos
- `updated_at` DATETIME(6) [NOT NULL]

### ARC-121 · `invoices` (table) · **transactional**
Facturas emitidas: importes, numeración, receptor, estado de cobro e impago.
**Columnas:**
- `invoice_id` CHAR(36) [PK, NOT NULL] — PK; clave de idempotencia del cobro
- `invoice_number` VARCHAR(20) [NOT NULL] — UNIQUE; GU-{AAAA}-{NNNNNN}; inmutable
- `series_year` SMALLINT [NOT NULL, FK→invoice_series_counters]
- `subscription_id` CHAR(36) [NOT NULL, FK→subscriptions] — UNIQUE (subscription_id, service_period_start)
- `billing_cycle_id` CHAR(36) [NOT NULL, FK→billing_cycles] — UNIQUE; una factura por ciclo
- `user_id` CHAR(36) [NOT NULL, FK→users]
- `modality_code` VARCHAR(20) [NOT NULL] — modalidad congelada en la factura; inmutable
- `concept` VARCHAR(100) [NOT NULL] — «Cuota GymUsers [modalidad]»; inmutable
- `service_period_start` DATE [NOT NULL] — inmutable
- `service_period_end` DATE [NOT NULL] — inmutable
- `issue_date` DATE [NOT NULL] — inmutable
- `due_date` DATE [NOT NULL] — issue_date + 15 días (REQ-099) frente a +14 (REQ-111) [contradicción]
- `net_amount_cents` INT [NOT NULL] — inmutable
- `tax_rate` DECIMAL(5,2) [NOT NULL] — inmutable
- `tax_amount_cents` INT [NOT NULL] — inmutable
- `total_amount_cents` INT [NOT NULL] — CHECK net + tax = total; = price_cents_snapshot
- `recipient_name` VARCHAR(201) [NOT NULL] — nombre y apellidos copiados del perfil; inmutable
- `recipient_address` VARCHAR(255) [NOT NULL] — copiado del perfil; inmutable
- `invoice_status` VARCHAR(20) [NOT NULL] — enum: PENDING_PAYMENT | PAID | UNPAID | CANCELLED; transiciones: PENDING_PAYMENT a PAID, UNPAID o CANCELLED; UNPAID a PAID
- `generation_source` VARCHAR(10) [NOT NULL] — enum: SIGNUP | SCHEDULED
- `billing_run_id` CHAR(36) [FK→job_runs] — obligatorio si SCHEDULED
- `payment_method_id` CHAR(36) [FK→payment_methods] — método congelado en la emisión
- `payment_method_type` VARCHAR(20) [NOT NULL] — enum: CARD | PAYPAL | BANK_TRANSFER
- `payment_reference` VARCHAR(140) — obligatorio si BANK_TRANSFER (= invoice_number)
- `charge_request_status` VARCHAR(20) — enum: REQUESTED | ACCEPTED | REJECTED | NO_PAYMENT_METHOD [inferido]
- `payment_transaction_id` CHAR(36) [FK→payment_transactions] — obligatorio si PAID; se aplica una sola vez por transacción
- `paid_at` DATETIME(6) — obligatorio si PAID
- `paid_late` TINYINT(1) [NOT NULL] — default 0; 1 si se cobra después de UNPAID
- `unpaid_at` DATETIME(6) — solo con close_reason EXHAUSTED
- `last_failure_code` VARCHAR(50) — código canónico normalizado
- `requires_admin_review` TINYINT(1) [NOT NULL] — default 0; 1 si la factura queda pendiente al procesar una baja
- `created_at` DATETIME(6) [NOT NULL]
- `updated_at` DATETIME(6) [NOT NULL] — solo cambian los campos de estado y de cobro
**Relaciones:**
- → `invoice_series_counters`: N:1 numerada en la serie anual
- → `subscriptions`: N:1 factura de la suscripción
- → `billing_cycles`: 1:1 factura del ciclo
- → `users`: N:1 factura del usuario
- → `job_runs`: N:1 emitida por la ejecución de facturación
- → `payment_methods`: N:1 método de pago congelado en la emisión
- → `payment_transactions`: 1:1 cobrada por la transacción

### ARC-122 · `subscription_cancellations` (table) · **transactional**
Bajas confirmadas, con la foto inmutable del cálculo proporcional y el estado de la devolución vinculada a la factura original.
**Columnas:**
- `cancellation_id` CHAR(36) [PK, NOT NULL] — PK; clave de idempotencia frente a MOD-003
- `subscription_id` CHAR(36) [NOT NULL, FK→subscriptions] — UNIQUE; una baja por suscripción
- `user_id` CHAR(36) [NOT NULL, FK→users]
- `original_invoice_id` CHAR(36) [FK→invoices] — factura del periodo vigente; si falta, REFUND_CALC_ERROR
- `idempotency_key` VARCHAR(64) [NOT NULL] — UNIQUE
- `cancellation_date` DATE [NOT NULL] — inmutable
- `cancellation_status` VARCHAR(20) [NOT NULL] — enum: CONFIRMED | REFUND_CALC_ERROR
- `period_start` DATE — foto del cálculo
- `period_end` DATE — foto del cálculo
- `period_fee_amount_cents` INT — foto del cálculo
- `days_consumed` SMALLINT — [ambigüedad: si el día de la baja cuenta como consumido]
- `days_remaining` SMALLINT
- `unconsumed_amount_cents` INT — <= amount_paid - already_refunded; inmutable
- `formula_version` VARCHAR(20)
- `original_payment_method` VARCHAR(20) — enum: CARD | PAYPAL | BANK_TRANSFER; el del cobro original
- `refund_status` VARCHAR(30) [NOT NULL] — enum: SIN_REEMBOLSO | REEMBOLSO_PENDIENTE | REEMBOLSO_SOLICITADO | REEMBOLSADO | REEMBOLSO_FALLIDO
- `refund_request_id` CHAR(36) — referencia lógica a refund_requests (la FK está en el otro lado para evitar un ciclo)
- `refund_failure_code` VARCHAR(50)
- `requires_manual_review` TINYINT(1) [NOT NULL] — default 0; factura ambigua o sin cobro enlazado
- `confirmed_ip` VARCHAR(45) — auditoría de la confirmación
- `created_at` DATETIME(6) [NOT NULL] — fecha y hora de la baja
- `updated_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `subscriptions`: 1:1 baja de la suscripción
- → `users`: N:1 baja del usuario
- → `invoices`: N:1 vinculada a la factura original

### ARC-123 · `payment_methods` (table) · **transactional**
Métodos de pago del usuario (IBAN, PayPal y tarjeta tokenizada), con datos cifrados o enmascarados y control de caducidad.
**Columnas:**
- `payment_method_id` CHAR(36) [PK, NOT NULL] — PK (id_metodo)
- `user_id` CHAR(36) [NOT NULL, FK→users]
- `method_type` VARCHAR(10) [NOT NULL] — enum: IBAN | PAYPAL | CARD
- `masked_reference` VARCHAR(100) [NOT NULL] — p. ej. IBAN ****1332 o Visa ****0366 exp 12/27
- `is_default` TINYINT(1) [NOT NULL] — default 0; como máximo uno activo por usuario
- `holder_name` VARCHAR(100) — obligatorio en IBAN y CARD
- `holder_surname` VARCHAR(100) — IBAN (REQ-026)
- `iban_encrypted` VARBINARY(256) — AES-256-GCM con IV propio; obligatorio en IBAN
- `iban_last4` CHAR(4)
- `bic_encrypted` VARBINARY(128) — 8 u 11 caracteres en claro
- `country_code` CHAR(2) — ISO 3166-1 alfa-2; lista blanca UE+ES [gap]
- `iban_validated_at` DATETIME(6)
- `failed_validation_count` TINYINT — 0-3
- `last_failed_validation_at` DATETIME(6)
- `risk_profile` VARCHAR(20) — enum: NORMAL | IBAN_INVALID; con IBAN_INVALID se bloquean los pagos por transferencia
- `paypal_customer_id_encrypted` VARBINARY(512) — AES-256-GCM; obligatorio en PAYPAL
- `paypal_email_encrypted` VARBINARY(512) — AES-256-GCM
- `paypal_access_token_encrypted` VARBINARY(1024) — AES-256; máx. 500 caracteres en claro; nunca en logs
- `paypal_refresh_token_encrypted` VARBINARY(1024) — AES-256
- `paypal_token_expiry` DATETIME(6) — un único conjunto de credenciales vigente por usuario
- `authorization_status` VARCHAR(20) — enum: AUTHORIZED | REVOKED
- `card_token` VARCHAR(255) — token opaco del gateway; indexado; nunca PAN ni CVV
- `card_brand` VARCHAR(20) — enum: VISA | MASTERCARD | AMEX | DISCOVER
- `card_last4` CHAR(4) — UNIQUE lógico (user_id, brand, last4, mes/año) entre las tarjetas activas
- `card_expiry_month` TINYINT — 1-12
- `card_expiry_year` SMALLINT — AAAA
- `card_status` VARCHAR(20) — enum: ACTIVE | EXPIRING_SOON | EXPIRED | REPLACED; default ACTIVE
- `expiry_checked_at` DATETIME(6)
- `expiry_alerted_at` DATETIME(6) — fecha_vencimiento_alertado
- `blocked_for_recurring` TINYINT(1) [NOT NULL] — default 0; con 1 se responde 409 payment_method_expired
- `replaced_by_payment_method_id` CHAR(36) [FK→payment_methods] — autorreferencia en la sustitución
- `created_at` DATETIME(6) [NOT NULL] — fecha_creacion
- `updated_at` DATETIME(6) [NOT NULL]
- `deleted_at` DATETIME(6) — borrado lógico; nunca se borra físicamente
**Relaciones:**
- → `users`: N:1 método de pago del usuario
- → `payment_methods`: N:1 sustituido por otro método

### ARC-124 · `payment_transactions` (table) · **transactional**
Transacciones de cobro por canal (tarjeta, PayPal y transferencia), con su estado, idempotencia, datos SCA y errores.
**Columnas:**
- `transaction_id` CHAR(36) [PK, NOT NULL] — PK; se crea en PENDING antes de llamar al proveedor
- `user_id` CHAR(36) [NOT NULL, FK→users]
- `subscription_id` CHAR(36) [FK→subscriptions]
- `invoice_id` CHAR(36) [FK→invoices] — factura cobrada
- `payment_method_id` CHAR(36) [FK→payment_methods]
- `payment_method_type` VARCHAR(20) [NOT NULL] — enum: CARD | PAYPAL | BANK_TRANSFER
- `correlation_id` CHAR(36) [NOT NULL] — indexado; se propaga a reintentos, ledger y reembolsos
- `gateway_name` VARCHAR(20) [NOT NULL] — enum: STRIPE | REDSYS | ADYEN | PAYPAL | BANK [gap: proveedor de tarjeta]
- `gateway_id` VARCHAR(100) — charge, payment_id o bank_reference; no se expone completo en el frontend
- `subscription_mode` VARCHAR(20) — enum: MONTHLY | QUARTERLY | ANNUAL; un solo cobro exitoso por usuario, modalidad y día
- `billing_period_start` DATE — subscription_period_start
- `billing_period_end` DATE — subscription_period_end
- `amount_cents` INT [NOT NULL] — > 0; transferencia entre 1500 y 50000
- `currency` CHAR(3) [NOT NULL] — EUR
- `description` VARCHAR(255)
- `status` VARCHAR(30) [NOT NULL] — enum: PENDING | AUTHORIZED | CAPTURED | FAILED | DECLINED | REFUND_PENDING | REFUNDED | FAILED_MANUAL_REVIEW; solo transiciones hacia delante
- `authorization_code` VARCHAR(100)
- `idempotency_key` VARCHAR(64) [NOT NULL] — UNIQUE; se reutiliza en los reintentos inmediatos
- `initiated_by` VARCHAR(10) [NOT NULL] — enum: USUARIO | ADMIN | SISTEMA
- `requested_by_id` CHAR(36) [FK→users] — ADMIN que actúa en nombre del usuario
- `iban_last4` CHAR(4) — solo en transferencia
- `error_code` VARCHAR(50) — código canónico (cat_payment_error_codes)
- `provider_error_code` VARCHAR(50) — código original del proveedor
- `error_message` VARCHAR(500) — saneado; sin PAN, CVV ni tokens
- `retry_count` TINYINT [NOT NULL] — default 0; máx. según cat_retry_policies
- `next_retry_at` DATETIME(6)
- `sca_status` VARCHAR(20) — enum: NOT_REQUIRED | REQUIRED | CHALLENGED | AUTHENTICATED | FAILED | ABANDONED | EXEMPTED
- `sca_exemption_type` VARCHAR(20) — enum: MIT | LOW_VALUE | TRA [gap: catálogo]
- `three_ds_version` VARCHAR(10)
- `authentication_value_encrypted` VARBINARY(256) — máx. 64 caracteres en claro; nunca en logs; prueba del liability shift
- `eci` VARCHAR(2)
- `challenge_started_at` DATETIME(6) — ventana de 10 min [inferido]; un challenge abierto por transacción
- `challenge_completed_at` DATETIME(6)
- `return_url` VARCHAR(2048) — https y en lista blanca del dominio GymUsers
- `is_refunded` TINYINT(1) [NOT NULL] — default 0; 1 solo con reembolso íntegro
- `initiated_at` DATETIME(6) [NOT NULL]
- `completed_at` DATETIME(6)
- `created_at` DATETIME(6) [NOT NULL]
- `updated_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `users`: N:1 cobro del usuario (y solicitado por ADMIN)
- → `subscriptions`: N:1 cobro de la suscripción
- → `invoices`: N:1 cobra la factura
- → `payment_methods`: N:1 con el método de pago

### ARC-125 · `transaction_ledger` (table) · **event_log**
Registro consolidado append-only de toda operación económica, con cadena de hashes, enlace de reembolsos y estado de conciliación.
**Columnas:**
- `ledger_id` CHAR(36) [PK, NOT NULL] — PK; sin DELETE ni UPDATE de los campos económicos
- `correlation_id` CHAR(36) [NOT NULL] — indexado
- `user_id` CHAR(36) [NOT NULL, FK→users] — se sustituye por seudónimo en el derecho al olvido
- `subscription_id` CHAR(36) [FK→subscriptions]
- `transaction_type` VARCHAR(20) [NOT NULL] — enum: PAYMENT | REFUND | RETRY_ATTEMPT
- `payment_method` VARCHAR(20) [NOT NULL] — enum: BANK_TRANSFER | PAYPAL | CARD; inmutable
- `provider_name` VARCHAR(30)
- `provider_transaction_id` VARCHAR(100) — UNIQUE (payment_method, provider_transaction_id, transaction_type); inmutable
- `amount_cents` INT [NOT NULL] — CHECK > 0; inmutable
- `currency` CHAR(3) [NOT NULL] — EUR; inmutable
- `status` VARCHAR(20) [NOT NULL] — enum: PENDING | AUTHORIZED | CAPTURED | FAILED | DECLINED | REFUNDED | RECONCILED; proyección del último evento
- `occurred_at` DATETIME(6) [NOT NULL] — UTC; no futura (tolerancia de 5 min); inmutable
- `recorded_at` DATETIME(6) [NOT NULL] — UTC
- `error_code` VARCHAR(50) — canónico
- `provider_error_code` VARCHAR(50)
- `error_nature` VARCHAR(10) — enum: TRANSIENT | PERMANENT | UNKNOWN
- `error_message` VARCHAR(500) — saneado; sin secuencias de 13 a 19 dígitos
- `source_table` VARCHAR(50) [NOT NULL] — tabla del canal de origen
- `source_reference` VARCHAR(100) [NOT NULL] — id del registro del canal
- `refunds_ledger_id` CHAR(36) [FK→transaction_ledger] — obligatorio en REFUND; PAYMENT en AUTHORIZED, CAPTURED o RECONCILED con el mismo método
- `refund_reason` VARCHAR(20) — enum: USER_CANCELLATION | PARTIAL_PERIOD | REFUND_ERROR
- `refunded_amount_total_cents` INT — derivado; <= amount_cents
- `partially_refunded` TINYINT(1) [NOT NULL] — default 0
- `compensates_ledger_id` CHAR(36) [FK→transaction_ledger] — asiento compensatorio
- `record_hash` CHAR(64) [NOT NULL] — SHA-256 de los campos económicos + previous_record_hash
- `previous_record_hash` CHAR(64) — cadena por user_id; nulo solo en el primer asiento
- `reconciled_at` DATETIME(6)
- `reconciliation_run_id` CHAR(36) [FK→job_runs]
- `match_type` VARCHAR(10) — enum: EXACT | HEURISTIC | NONE; HEURISTIC queda pendiente de confirmación por ADMIN
- `legal_hold` TINYINT(1) [NOT NULL] — default 0; con 1 se excluye de la purga
**Relaciones:**
- → `users`: N:1 asiento del usuario
- → `subscriptions`: N:1 asiento de la suscripción
- → `transaction_ledger`: N:1 reembolsa o compensa otro asiento
- → `job_runs`: N:1 conciliado en la ejecución

### ARC-126 · `transaction_events` (table) · **event_log**
Línea de eventos append-only de cobros y reembolsos (intentos, reintentos, respuestas, webhooks, cambios de estado y conciliación).
**Columnas:**
- `event_id` CHAR(36) [PK, NOT NULL] — PK; append-only
- `correlation_id` CHAR(36) [NOT NULL] — indexado
- `ledger_id` CHAR(36) [FK→transaction_ledger] — nulo hasta que existe el asiento
- `transaction_id` CHAR(36) [FK→payment_transactions]
- `refund_id` CHAR(36) [FK→refund_transactions]
- `event_type` VARCHAR(30) [NOT NULL] — enum: INITIATED | PROVIDER_REQUEST | PROVIDER_RESPONSE | RETRY | WEBHOOK_RECEIVED | STATUS_CHANGED | REFUND_LINKED | RECONCILED | EXCEPTION_RAISED
- `source` VARCHAR(20) [NOT NULL] — enum: SYSTEM | WEBHOOK | RECONCILIATION | ADMIN
- `status_before` VARCHAR(20)
- `status_after` VARCHAR(20)
- `attempt_number` TINYINT — intentos y reintentos (payment_retries)
- `http_status_code` SMALLINT
- `error_code` VARCHAR(50)
- `error_nature` VARCHAR(10) — enum: TRANSIENT | PERMANENT | UNKNOWN
- `backoff_delay_sec` INT
- `payload_sanitized` JSON [NOT NULL] — sin secuencias de 13-19 dígitos ni claves card_number, cvv, token, api_key o access_token; máx. 16 KB
- `payload_truncated` TINYINT(1) [NOT NULL] — default 0
- `actor_type` VARCHAR(10) [NOT NULL] — enum: SYSTEM | ADMIN
- `actor_id` VARCHAR(50)
- `orphan` TINYINT(1) [NOT NULL] — default 0; con 1 se abre una excepción
- `occurred_at` DATETIME(6) [NOT NULL] — UTC
**Relaciones:**
- → `transaction_ledger`: N:1 evento del asiento
- → `payment_transactions`: N:1 evento de la transacción
- → `refund_transactions`: N:1 evento del reembolso

### ARC-127 · `refund_requests` (table) · **transactional**
Órdenes de reembolso que MOD-002 envía al registrar una baja, enrutadas al método del cobro original, con sus reintentos y su revisión manual.
**Columnas:**
- `refund_request_id` CHAR(36) [PK, NOT NULL] — PK
- `cancellation_id` CHAR(36) [NOT NULL, FK→subscription_cancellations] — UNIQUE; clave de idempotencia
- `original_transaction_id` CHAR(36) [NOT NULL, FK→payment_transactions] — una sola orden activa (PENDING, PROCESSING o MANUAL_REVIEW) por transacción
- `original_ledger_id` CHAR(36) [NOT NULL, FK→transaction_ledger] — el método se deriva de este asiento
- `user_id` CHAR(36) [NOT NULL, FK→users] — debe ser el titular de la transacción original
- `payment_method` VARCHAR(20) [NOT NULL] — igual al original; si no coincide, 422 refund_method_mismatch
- `refund_amount_cents` INT [NOT NULL] — > 0 y <= importe reembolsable; no se recalcula
- `currency` CHAR(3) [NOT NULL] — EUR
- `refund_request_status` VARCHAR(20) [NOT NULL] — enum: PENDING | PROCESSING | COMPLETED | FAILED | MANUAL_REVIEW; COMPLETED exige refund_ledger_id
- `correlation_id` CHAR(36) [NOT NULL] — heredado del cobro original
- `idempotency_key` VARCHAR(64) [NOT NULL] — la misma en todos los reintentos
- `attempt_number` TINYINT [NOT NULL] — máx. 3 reintentos automáticos
- `next_retry_at` DATETIME(6) — backoff de 1 h, 6 h y 24 h [inferido]
- `error_nature` VARCHAR(10) — enum: TRANSIENT | PERMANENT | UNKNOWN
- `manual_review_reason` VARCHAR(40) — enum: PERMANENT_ERROR | RETRIES_EXHAUSTED | PROVIDER_WINDOW_EXPIRED | PAYMENT_REFERENCE_UNAVAILABLE | IBAN_INVALID
- `resolution_action` VARCHAR(30) — enum: RETRY_SAME_METHOD | RESOLVED_EXTERNALLY; no existe la cancelación
- `external_reference` VARCHAR(100) — obligatoria si RESOLVED_EXTERNALLY
- `resolution_note` VARCHAR(1000) — mínimo 20 caracteres
- `resolved_by_admin_id` CHAR(36) [FK→users] — solo ADMIN
- `refund_ledger_id` CHAR(36) [FK→transaction_ledger] — asiento REFUND
- `completed_at` DATETIME(6)
- `created_at` DATETIME(6) [NOT NULL]
- `updated_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `subscription_cancellations`: 1:1 orden de reembolso de la baja
- → `payment_transactions`: N:1 reembolsa la transacción original
- → `transaction_ledger`: N:1 asiento original y asiento REFUND
- → `users`: N:1 titular y ADMIN que resuelve

### ARC-128 · `refund_transactions` (table) · **transactional**
Ejecución de cada reembolso en su canal (gateway, PayPal o SEPA saliente), con su estado técnico y de negocio.
**Columnas:**
- `refund_id` CHAR(36) [PK, NOT NULL] — PK (refund_tracking_id)
- `refund_request_id` CHAR(36) [NOT NULL, FK→refund_requests] — una sola transferencia saliente por orden
- `retry_of_refund_id` CHAR(36) [FK→refund_transactions] — un reintento crea un registro nuevo
- `user_id` CHAR(36) [NOT NULL, FK→users]
- `original_transaction_id` CHAR(36) [NOT NULL, FK→payment_transactions] — como máximo un reembolso no FAILED por transacción en 24 h
- `refund_method` VARCHAR(20) [NOT NULL] — enum: CARD | PAYPAL | BANK_TRANSFER; igual al del cobro
- `gateway_name` VARCHAR(20) [NOT NULL]
- `gateway_refund_id` VARCHAR(100) — solo cuando el proveedor confirma
- `refund_amount_cents` INT [NOT NULL] — entre 1 céntimo y el importe original
- `currency` CHAR(3) [NOT NULL] — EUR
- `reason` VARCHAR(20) [NOT NULL] — enum: USER_CANCELLATION | PARTIAL_PERIOD | REFUND_ERROR
- `status` VARCHAR(20) [NOT NULL] — técnico; enum: PENDING | INITIATED | SENT | SUCCEEDED | RETURNED | FAILED | REJECTED
- `business_status` VARCHAR(10) [NOT NULL] — enum: PENDING | COMPLETED | FAILED; solo PENDING a COMPLETED o FAILED (estados finales)
- `failure_code` VARCHAR(50) — obligatorio si y solo si business_status=FAILED; canónico
- `error_code` VARCHAR(50) — código del proveedor
- `error_message` VARCHAR(500) — saneado; nunca el mensaje bruto
- `beneficiary_name` VARCHAR(201) — transferencia
- `beneficiary_iban_encrypted` VARBINARY(256) — checksum revalidado al emitir; custodia pendiente de decisión (contradicción con REQ-084)
- `beneficiary_iban_last4` CHAR(4)
- `remittance_reference` VARCHAR(140) — UNIQUE; remittance_info SEPA
- `bank_reference` VARCHAR(100)
- `bank_return_code` VARCHAR(10) — ISO 20022; se mapea a failure_code [pendiente: cat_sepa_return_codes]
- `settled_at` DATE — = fecha valor del cargo
- `initiated_at` DATETIME(6) [NOT NULL]
- `status_updated_at` DATETIME(6) [NOT NULL]
- `created_at` DATETIME(6) [NOT NULL]
- `updated_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `refund_requests`: N:1 ejecuta la orden de reembolso
- → `refund_transactions`: N:1 reintento de un reembolso fallido
- → `users`: N:1 reembolso del usuario
- → `payment_transactions`: N:1 devuelve la transacción original

### ARC-129 · `dunning_cycles` (table) · **transactional**
Ciclos de recobro de las renovaciones fallidas (tarjeta y PayPal) y plazos de gracia de las transferencias, hasta su recuperación o impago.
**Columnas:**
- `dunning_cycle_id` CHAR(36) [PK, NOT NULL] — PK
- `user_id` CHAR(36) [NOT NULL, FK→users] — un solo ciclo abierto por (user_id, billing_period_start) entre todos los métodos
- `subscription_id` CHAR(36) [NOT NULL, FK→subscriptions]
- `invoice_id` CHAR(36) [NOT NULL, FK→invoices]
- `billing_period_start` DATE [NOT NULL]
- `subscription_mode` VARCHAR(20) [NOT NULL] — enum: MONTHLY | QUARTERLY | ANNUAL
- `payment_method` VARCHAR(20) [NOT NULL] — enum: CARD | PAYPAL | BANK_TRANSFER
- `payment_method_id` CHAR(36) [FK→payment_methods]
- `original_transaction_id` CHAR(36) [FK→payment_transactions] — nulo en BANK_TRANSFER (no se lanza cobro)
- `correlation_id` CHAR(36) [NOT NULL] — se mantiene entre reintentos
- `initiated_by` VARCHAR(10) [NOT NULL] — SISTEMA
- `status` VARCHAR(40) [NOT NULL] — enum: OPEN | SUSPENDED_AWAITING_CARD | SUSPENDED_AWAITING_PAYMENT_METHOD | AWAITING_TRANSFER | RECOVERED | UNPAID
- `close_reason` VARCHAR(30) — enum: EXHAUSTED | USER_CANCELLED | PERMANENT_ERROR | RECOVERED
- `retry_policy_id` INT [FK→cat_retry_policies] — versión congelada al abrir el ciclo
- `attempt_number` TINYINT [NOT NULL] — <= max_attempts de la política
- `outage_reschedules` TINYINT [NOT NULL] — default 0; <= max_outage_reschedules
- `next_retry_at` DATETIME(6) — siempre futura al programarse
- `last_error_code` VARCHAR(50) — no visible para el USUARIO
- `last_error_nature` VARCHAR(10) — enum: TRANSIENT | PERMANENT | UNKNOWN
- `amount_cents` INT [NOT NULL] — importe de la cuota según la modalidad
- `amount_received_cents` INT [NOT NULL] — default 0; <= abonos conciliados imputados
- `currency` CHAR(3) [NOT NULL] — EUR
- `payment_reference` VARCHAR(140) — obligatoria en BANK_TRANSFER
- `grace_deadline_at` DATETIME(6) — > opened_at [gap: plazo de gracia]
- `last_checked_at` DATETIME(6)
- `idempotency_key` VARCHAR(64) — nueva en cada reintento
- `forced_by_admin_id` CHAR(36) [FK→users]
- `forced_at` DATETIME(6)
- `opened_at` DATETIME(6) [NOT NULL]
- `closed_at` DATETIME(6)
**Relaciones:**
- → `users`: N:1 ciclo del usuario (y forzado por ADMIN)
- → `subscriptions`: N:1 ciclo de la suscripción
- → `invoices`: N:1 recobra la factura
- → `payment_methods`: N:1 con el método de pago
- → `payment_transactions`: N:1 parte de la transacción fallida
- → `cat_retry_policies`: N:1 aplica la versión de política

### ARC-130 · `cat_retry_policies` (table) · **catalog**
Política de reintentos de cobro versionada por método de pago y fase (también cat_dunning_schedule).
**Columnas:**
- `policy_id` INT [PK, NOT NULL] — PK; versiones inmutables
- `payment_method` VARCHAR(20) [NOT NULL] — enum: CARD | PAYPAL | BANK_TRANSFER; semilla de 6 combinaciones [pendiente: valores iniciales del cliente]
- `retry_stage` VARCHAR(10) [NOT NULL] — enum: IMMEDIATE | DEFERRED
- `version` INT [NOT NULL] — UNIQUE (payment_method, retry_stage, version); control optimista (409)
- `max_attempts` TINYINT [NOT NULL] — 0-5; 0 exige confirmación explícita
- `retry_intervals_minutes` JSON [NOT NULL] — array creciente de longitud max_attempts; IMMEDIATE <= 60 min y DEFERRED <= 25 días
- `retry_unknown` TINYINT(1) [NOT NULL] — default 0; PERMANENT nunca se reintenta
- `gateway_outage_backoff_minutes` SMALLINT [NOT NULL] — 15-1440; default 360
- `max_outage_reschedules` TINYINT [NOT NULL] — 0-5; default 2
- `is_active` TINYINT(1) [NOT NULL] — una sola activa por combinación; sin activa no se reintenta
- `valid_from` DATETIME(6) [NOT NULL]
- `change_reason` VARCHAR(500) [NOT NULL] — 10-500 caracteres
- `created_by_admin_id` CHAR(36) [FK→users] — nulo en la semilla
- `created_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `users`: N:1 versión creada por ADMIN

### ARC-131 · `cat_payment_error_codes` (table) · **catalog**
Correspondencia entre los códigos de error de cada proveedor y el código canónico, con su naturaleza y el mensaje al usuario.
**Columnas:**
- `error_code_id` INT [PK, NOT NULL] — PK
- `provider_name` VARCHAR(30) [NOT NULL] — UNIQUE (provider_name, provider_error_code)
- `provider_error_code` VARCHAR(50) [NOT NULL] — semilla: card_declined, insufficient_funds, expired_card, card_not_supported, processing_error, gateway_timeout, rate_limit [gap: catálogo PayPal y SEPA]
- `canonical_error_code` VARCHAR(50) [NOT NULL] — UNMAPPED_PROVIDER_ERROR si no hay correspondencia
- `error_nature` VARCHAR(10) [NOT NULL] — enum: TRANSIENT | PERMANENT | UNKNOWN
- `user_facing_message_key` VARCHAR(100) — texto orientado al usuario
- `created_at` DATETIME(6) [NOT NULL]
- `updated_at` DATETIME(6) [NOT NULL] — solo lo mantiene ADMIN

### ARC-132 · `gateway_webhook_events` (table) · **event_log**
Notificaciones asíncronas firmadas de PayPal y del gateway de tarjeta, deduplicadas y con su estado de procesamiento.
**Columnas:**
- `webhook_event_id` CHAR(36) [PK, NOT NULL] — PK
- `provider_name` VARCHAR(30) [NOT NULL] — enum: PAYPAL | STRIPE | REDSYS | ADYEN
- `provider_event_id` VARCHAR(100) [NOT NULL] — UNIQUE (provider_name, provider_event_id); clave de deduplicación
- `event_type_raw` VARCHAR(100) [NOT NULL] — [gap: cat_gateway_event_types]
- `provider_transaction_id` VARCHAR(100)
- `transaction_id` CHAR(36) [FK→payment_transactions]
- `refund_id` CHAR(36) [FK→refund_transactions]
- `amount_cents` INT — si difiere del asiento, UNMATCHED
- `signature_valid` TINYINT(1) [NOT NULL] — HMAC; timestamp <= 5 min
- `source_ip` VARCHAR(45) — se audita si la firma es inválida
- `payload_sanitized` JSON [NOT NULL] — <= 256 KB; PAN sustituido por ****; sin CVV ni card_token; ADMIN no ve el contenido íntegro
- `processing_status` VARCHAR(20) [NOT NULL] — enum: RECEIVED | PROCESSED | IGNORED | IGNORED_DUPLICATE | REJECTED_SIGNATURE | ORPHAN | UNMATCHED | ERROR
- `match_retry_until` DATETIME(6) — reemparejamiento durante 15 min
- `error_message` VARCHAR(500) — sin datos sensibles
- `received_at` DATETIME(6) [NOT NULL] — UTC
- `processed_at` DATETIME(6)
**Relaciones:**
- → `payment_transactions`: N:1 notifica la transacción
- → `refund_transactions`: N:1 notifica el reembolso

### ARC-133 · `reconciliation_exceptions` (table) · **transactional**
Bandeja única de discrepancias de conciliación, ledger e integridad, con su ciclo de revisión y su resolución.
**Columnas:**
- `exception_id` CHAR(36) [PK, NOT NULL] — PK
- `exception_type` VARCHAR(30) [NOT NULL] — enum: MISSING_LOCAL | MISSING_PROVIDER | AMOUNT_MISMATCH | CURRENCY_MISMATCH | STATUS_MISMATCH | UNIDENTIFIED_CREDIT | PAYMENT_NOT_RECEIVED | UNMATCHED_WEBHOOK | INTEGRITY_BROKEN | UNMAPPED_PROVIDER_ERROR | REFUND_FAILED
- `severity` VARCHAR(10) [NOT NULL] — enum: HIGH | MEDIUM | LOW
- `ledger_id` CHAR(36) [FK→transaction_ledger] — MISSING_LOCAL y AMOUNT_MISMATCH abiertas bloquean la purga
- `refund_request_id` CHAR(36) [FK→refund_requests]
- `bank_entry_id` CHAR(36) [FK→bank_statement_entries]
- `provider_name` VARCHAR(30)
- `provider_transaction_id` VARCHAR(100)
- `detected_by_run_id` CHAR(36) [FK→job_runs]
- `status` VARCHAR(20) [NOT NULL] — enum: OPEN | IN_REVIEW | RESOLVED | DISMISSED; OPEN > 15 días se escala [gap]
- `assigned_admin_id` CHAR(36) [FK→users]
- `resolution_type` VARCHAR(30) — enum: COMPENSATING_ENTRY | MANUAL_MATCH | PROVIDER_ERROR | NO_ACTION_REQUIRED; obligatorio en RESOLVED
- `resolution_note` VARCHAR(1000) — 20-1000 caracteres al cerrar
- `resolved_by_admin_id` CHAR(36) [FK→users] — un cierre concurrente responde 409
- `detected_at` DATETIME(6) [NOT NULL]
- `resolved_at` DATETIME(6)
**Relaciones:**
- → `transaction_ledger`: N:1 discrepancia del asiento
- → `refund_requests`: N:1 discrepancia de la orden de reembolso
- → `bank_statement_entries`: N:1 discrepancia del movimiento bancario
- → `job_runs`: N:1 detectada por la ejecución
- → `users`: N:1 asignada y resuelta por ADMIN

### ARC-134 · `bank_statement_imports` (table) · **transactional**
Extractos bancarios ingeridos, controlados por hash e importados de forma todo o nada; el fichero se guarda cifrado en el almacén de ficheros.
**Columnas:**
- `import_id` CHAR(36) [PK, NOT NULL] — PK
- `file_name` VARCHAR(255) [NOT NULL]
- `file_hash` CHAR(64) [NOT NULL] — UNIQUE; un fichero se procesa una sola vez
- `storage_object_key` VARCHAR(500) [NOT NULL] — clave del objeto en ARC-026; cifrado; acceso solo ADMIN_AUDIT
- `statement_date` DATE [NOT NULL]
- `entries_total` INT [NOT NULL] — >= 0
- `entries_matched` INT [NOT NULL] — matched + unmatched = total
- `entries_unmatched` INT [NOT NULL]
- `import_status` VARCHAR(10) [NOT NULL] — enum: RECEIVED | PARSED | PROCESSED | REJECTED
- `rejection_detail` VARCHAR(500)
- `imported_by` VARCHAR(10) [NOT NULL] — enum: SYSTEM | ADMIN [gap: canal y formato del extracto]
- `imported_by_admin_id` CHAR(36) [FK→users] — subida manual solo por ADMIN
- `imported_at` DATETIME(6) [NOT NULL] — UTC
**Relaciones:**
- → `users`: N:1 subido por ADMIN

### ARC-135 · `bank_statement_entries` (table) · **transactional**
Movimientos del extracto (abonos de cobros y cargos de devoluciones) con su emparejamiento.
**Columnas:**
- `entry_id` CHAR(36) [PK, NOT NULL] — PK
- `import_id` CHAR(36) [NOT NULL, FK→bank_statement_imports]
- `entry_direction` VARCHAR(6) [NOT NULL] — enum: CREDIT | DEBIT
- `value_date` DATE [NOT NULL] — no futura
- `amount_cents` INT [NOT NULL] — > 0
- `counterparty_iban_masked` VARCHAR(10) — solo los 4 últimos caracteres (ordenante o beneficiario)
- `remittance_reference` VARCHAR(140)
- `bank_return_code` VARCHAR(10) — retorno SEPA
- `match_type` VARCHAR(10) — enum: EXACT | HEURISTIC | NONE; HEURISTIC por IBAN + importe + fecha ±5 días hábiles
- `ledger_id` CHAR(36) [FK→transaction_ledger] — una línea se empareja como máximo con una transacción
- `refund_id` CHAR(36) [FK→refund_transactions] — cargo de una devolución
- `dunning_cycle_id` CHAR(36) [FK→dunning_cycles] — un abono se imputa a un solo ciclo
- `match_confirmed_by` CHAR(36) [FK→users] — obligatorio en HEURISTIC; solo ADMIN
- `match_confirmed_at` DATETIME(6)
- `created_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `bank_statement_imports`: N:1 movimiento del extracto
- → `transaction_ledger`: N:1 emparejado con el asiento
- → `refund_transactions`: N:1 cargo de la devolución
- → `dunning_cycles`: N:1 abono imputado al ciclo
- → `users`: N:1 emparejamiento confirmado por ADMIN

### ARC-136 · `event_outbox` (table) · **transactional**
Outbox transaccional de eventos de dominio entre módulos, con reintentos de entrega y cuarentena (ledger_dead_letter).
**Columnas:**
- `outbox_id` CHAR(36) [PK, NOT NULL] — PK
- `event_id` CHAR(36) [NOT NULL] — UNIQUE; exactamente un evento por transición
- `event_type` VARCHAR(60) [NOT NULL] — PaymentAuthorized, PaymentFailed, PaymentProcessed, InvoiceUnpaid, RefundCompleted, RefundFailed, SubscriptionCancelled, UserRegistered…
- `aggregate_type` VARCHAR(50) [NOT NULL]
- `aggregate_id` VARCHAR(100) [NOT NULL]
- `correlation_id` CHAR(36)
- `target_consumer` VARCHAR(50) [NOT NULL] — p. ej. MOD-002, LEDGER o NOTIFICATIONS
- `payload` JSON [NOT NULL] — como máximo los 4 últimos dígitos; nunca PAN, token ni IBAN completo
- `status` VARCHAR(20) [NOT NULL] — enum: PENDING | DELIVERED | FAILED | DEAD_LETTER; un evento malformado va a DEAD_LETTER sin reintento
- `attempt_count` TINYINT [NOT NULL] — máx. 10 (cada 30 s) antes de alertar a ADMIN
- `next_attempt_at` DATETIME(6)
- `last_error` VARCHAR(500)
- `created_at` DATETIME(6) [NOT NULL] — en la misma transacción de BD que el cambio de estado
- `delivered_at` DATETIME(6)

### ARC-137 · `cat_payment_reminder_schedule` (table) · **catalog**
Configuración versionada del calendario de avisos de impago: hitos, canales, franja de SMS y tope de avisos por factura.
**Columnas:**
- `config_version` INT [PK, NOT NULL] — PK; versiones inmutables; control optimista (409)
- `steps` JSON [NOT NULL] — [{offset_days, channels}]; offsets crecientes y únicos de 1 a 60; máx. 5 hitos; semilla: [{3: EMAIL+SMS}, {7: EMAIL}, {14: EMAIL}]
- `max_notifications_per_invoice` TINYINT [NOT NULL] — 1-5; default 3
- `sms_window_start` TIME [NOT NULL] — default 09:00 (Europe/Madrid)
- `sms_window_end` TIME [NOT NULL] — default 21:00
- `is_active` TINYINT(1) [NOT NULL] — una sola activa; sin activa no se envían avisos
- `change_reason` VARCHAR(500) [NOT NULL] — 10-500 caracteres
- `created_by_admin_id` CHAR(36) [FK→users] — nulo en la semilla
- `created_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `users`: N:1 versión creada por ADMIN

### ARC-138 · `payment_reminder_cases` (table) · **transactional**
Casos de aviso de impago por factura vencida, con la configuración congelada al abrirse.
**Columnas:**
- `case_id` CHAR(36) [PK, NOT NULL] — PK
- `invoice_id` CHAR(36) [NOT NULL, FK→invoices] — como máximo un caso OPEN por factura
- `user_id` CHAR(36) [NOT NULL, FK→users]
- `config_version` INT [NOT NULL, FK→cat_payment_reminder_schedule] — congelada al abrir el caso
- `trigger_source` VARCHAR(20) [NOT NULL] — enum: DETECTOR | INVOICE_UNPAID
- `case_status` VARCHAR(10) [NOT NULL] — enum: OPEN | CLOSED; solo OPEN a CLOSED
- `close_reason` VARCHAR(30) — enum: INVOICE_PAID | INVOICE_CANCELLED | SUBSCRIPTION_CANCELLED | SCHEDULE_COMPLETED | MAX_NOTIFICATIONS_REACHED
- `dispatched_count` TINYINT [NOT NULL] — default 0; <= tope; se actualiza con bloqueo de fila
- `opened_at` DATETIME(6) [NOT NULL]
- `closed_at` DATETIME(6)
**Relaciones:**
- → `invoices`: N:1 caso de aviso de la factura
- → `users`: N:1 caso del usuario
- → `cat_payment_reminder_schedule`: N:1 configuración congelada del caso

### ARC-139 · `payment_reminder_steps` (table) · **transactional**
Hitos programados de cada caso de aviso por día y canal, con su estado de despacho.
**Columnas:**
- `step_id` CHAR(36) [PK, NOT NULL] — PK
- `case_id` CHAR(36) [NOT NULL, FK→payment_reminder_cases]
- `reminder_ordinal` TINYINT [NOT NULL] — determina la plantilla del hito
- `offset_days` TINYINT [NOT NULL] — 1-60
- `channel` VARCHAR(5) [NOT NULL] — enum: EMAIL | SMS
- `scheduled_for` DATE [NOT NULL] — = due_date + offset_days
- `not_before` DATETIME(6) — SMS aplazado hasta que se abre la franja
- `step_status` VARCHAR(12) [NOT NULL] — enum: SCHEDULED | DISPATCHED | SKIPPED | CANCELLED; DISPATCHED no cambia
- `skip_reason` VARCHAR(30) — enum: CATCH_UP | NO_CONTACT_DATA | MAX_NOTIFICATIONS_REACHED
- `consolidation_key` VARCHAR(100) — agrupa por usuario, día y canal
- `dispatched_at` DATETIME(6)
- `created_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `payment_reminder_cases`: N:1 hito del caso

### ARC-140 · `notification_attempts` (table) · **event_log**
Intentos append-only de envío de email y SMS de los avisos de impago, con su idempotencia y su resultado.
**Columnas:**
- `attempt_id` CHAR(36) [PK, NOT NULL] — PK; sin UPDATE ni DELETE desde la aplicación
- `step_id` CHAR(36) [NOT NULL, FK→payment_reminder_steps]
- `user_id` CHAR(36) [NOT NULL, FK→users]
- `channel` VARCHAR(5) [NOT NULL] — enum: EMAIL | SMS
- `attempt_number` TINYINT [NOT NULL] — 1-4
- `idempotency_key` VARCHAR(100) [NOT NULL] — UNIQUE; = step_id + canal + attempt_number
- `destination_encrypted` VARBINARY(512) [NOT NULL] — email o móvil E.164 vigente en el envío
- `destination_masked` VARCHAR(100) [NOT NULL] — valor por defecto en las consultas
- `template_id` INT [FK→notification_templates] — versión de plantilla usada
- `rendered_with_fallback` TINYINT(1) [NOT NULL] — default 0
- `provider_config_id` INT [FK→notification_provider_configs] — versión SMTP o SMS fijada al iniciar el envío
- `provider_message_id` VARCHAR(255) — smtp_message_id o id del proveedor de SMS
- `attempt_result` VARCHAR(10) [NOT NULL] — enum: SENT | FAILED | CANCELLED
- `error_class` VARCHAR(10) — enum: TRANSIENT | PERMANENT; solo TRANSIENT se reintenta
- `error_code` VARCHAR(50) — p. ej. TEMPLATE_DATA_MISSING
- `attempted_at` DATETIME(6) [NOT NULL]
- `next_retry_at` DATETIME(6) — > attempted_at; backoff de 5, 30 y 120 min
**Relaciones:**
- → `payment_reminder_steps`: N:1 intento del hito
- → `users`: N:1 destinatario del aviso
- → `notification_templates`: N:1 plantilla usada
- → `notification_provider_configs`: N:1 configuración de proveedor usada

### ARC-141 · `notification_delivery_events` (table) · **event_log**
Callbacks firmados y DLR de entrega de los proveedores de email y SMS; el estado de cada intento se proyecta desde aquí.
**Columnas:**
- `delivery_event_id` CHAR(36) [PK, NOT NULL] — PK; append-only
- `attempt_id` CHAR(36) [FK→notification_attempts] — nulo si el evento es huérfano
- `channel` VARCHAR(5) [NOT NULL] — enum: EMAIL | SMS
- `provider_message_id` VARCHAR(255) [NOT NULL] — si es desconocido, 202 y orphan=1
- `provider_event_type` VARCHAR(30) [NOT NULL] — delivered, bounced, complaint o DLR
- `delivery_status` VARCHAR(10) [NOT NULL] — enum: QUEUED | SENT | DELIVERED | BOUNCED | FAILED | UNKNOWN; un estado final no retrocede; UNKNOWN a las 72 h
- `signature_valid` TINYINT(1) [NOT NULL] — firma inválida responde 401
- `orphan` TINYINT(1) [NOT NULL] — default 0
- `received_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `notification_attempts`: N:1 estado de entrega del intento

### ARC-142 · `cat_sms_providers` (table) · **catalog**
Catálogo de proveedores de SMS admitidos y del esquema de credenciales que pide cada uno.
**Columnas:**
- `provider_code` VARCHAR(20) [PK, NOT NULL] — PK; semilla: TWILIO | AWS_SNS | VONAGE [gap: lista cerrada]
- `display_name` VARCHAR(50) [NOT NULL]
- `credential_schema` JSON [NOT NULL] — campos de credencial exigidos (p. ej. account_sid y auth_token)
- `is_active` TINYINT(1) [NOT NULL]

### ARC-143 · `notification_provider_configs` (table) · **transactional**
Configuración versionada de los proveedores SMTP y SMS, con los secretos cifrados.
**Columnas:**
- `config_id` INT [PK, NOT NULL] — PK
- `channel` VARCHAR(5) [NOT NULL] — enum: EMAIL | SMS; UNIQUE (channel, version)
- `version` INT [NOT NULL] — control optimista (409); las versiones anteriores se conservan para la cola
- `sms_provider_code` VARCHAR(20) [FK→cat_sms_providers] — obligatorio si channel=SMS
- `smtp_host` VARCHAR(255) — obligatorio si channel=EMAIL
- `smtp_port` INT
- `auth_type` VARCHAR(20) — enum: PASSWORD | API_KEY
- `username` VARCHAR(255)
- `secret_encrypted` VARBINARY(2048) [NOT NULL] — AES-256-GCM con gestor de secretos; nunca en claro en API ni logs
- `secret_last4` CHAR(4) — has_secret y enmascarado
- `secret_updated_at` DATETIME(6)
- `encryption_type` VARCHAR(10) — enum: TLS | SSL | NONE
- `sender` VARCHAR(255) [NOT NULL] — from del email, o sender_id E.164 o alfanumérico de 1 a 11 caracteres
- `timeout_seconds` SMALLINT
- `max_retries` TINYINT [NOT NULL] — SMS 0-3 (solo rebaja el tope de REQ-132)
- `retry_initial_interval_seconds` INT — SMTP
- `retry_multiplier` DECIMAL(4,2) — SMTP
- `rate_limit_per_minute` SMALLINT — SMS 1-600; default 60
- `is_active` TINYINT(1) [NOT NULL] — una sola activa por canal
- `validation_id` CHAR(36) [NOT NULL, FK→provider_config_validations] — validación OK vigente (< 15 min) con el mismo params_hash
- `change_reason` VARCHAR(500) [NOT NULL]
- `created_by_admin_id` CHAR(36) [NOT NULL, FK→users]
- `created_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `cat_sms_providers`: N:1 proveedor de SMS
- → `provider_config_validations`: N:1 respaldada por la validación
- → `users`: N:1 creada por ADMIN

### ARC-144 · `provider_config_validations` (table) · **event_log**
Validaciones de conexión SMTP y SMS previas al guardado, con su diagnóstico.
**Columnas:**
- `validation_id` CHAR(36) [PK, NOT NULL] — PK
- `channel` VARCHAR(5) [NOT NULL] — enum: EMAIL | SMS
- `admin_id` CHAR(36) [NOT NULL, FK→users] — máx. 10 validaciones/min (SMTP) o 10 cada 10 min (SMS)
- `params_hash` CHAR(64) [NOT NULL] — hash del borrador validado
- `result` VARCHAR(10) [NOT NULL] — enum: OK | FAILED
- `failed_step` VARCHAR(10) — enum: DNS | CONNECT | TLS | AUTH | SENDER
- `error_code` VARCHAR(50)
- `error_detail` VARCHAR(500) — saneado; nunca el secreto
- `duration_ms` INT
- `expires_at` DATETIME(6) — validez de 15 min [inferido]
- `validated_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `users`: N:1 lanzada por ADMIN

### ARC-145 · `notification_templates` (table) · **catalog**
Plantillas versionadas de email y SMS de los avisos de impago, sembradas en el despliegue y editables por ADMIN.
**Columnas:**
- `template_id` INT [PK, NOT NULL] — PK
- `channel` VARCHAR(5) [NOT NULL] — enum: EMAIL | SMS
- `template_key` VARCHAR(30) [NOT NULL] — semilla: PAYMENT_REMINDER_1..5 (email) y UNPAID_REMINDER_1..2 (SMS) [pendiente: textos del cliente]; UNIQUE (channel, template_key, version)
- `display_name` VARCHAR(100) [NOT NULL]
- `reminder_ordinal` TINYINT [NOT NULL] — hito al que aplica
- `version` INT [NOT NULL] — control optimista (409)
- `subject` VARCHAR(255) — obligatorio en EMAIL; debe contener «Pago Pendiente»
- `body` TEXT [NOT NULL] — solo variables del catálogo; SMS <= 160 caracteres GSM-7
- `is_active` TINYINT(1) [NOT NULL] — una activa por (channel, template_key)
- `is_customized` TINYINT(1) [NOT NULL] — 0 en la predefinida sembrada
- `change_reason` VARCHAR(500)
- `created_by_admin_id` CHAR(36) [FK→users]
- `created_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `users`: N:1 versión creada por ADMIN

### ARC-146 · `template_test_sends` (table) · **event_log**
Envíos de prueba de plantillas de email y SMS al propio ADMIN, con valores ficticios.
**Columnas:**
- `test_send_id` CHAR(36) [PK, NOT NULL] — PK
- `channel` VARCHAR(5) [NOT NULL] — enum: EMAIL | SMS
- `template_id` INT [FK→notification_templates] — nulo si se prueba un borrador sin guardar
- `admin_id` CHAR(36) [NOT NULL, FK→users] — el destino es siempre el email o móvil propio; email 5/min, SMS 5/hora
- `provider_config_id` INT [FK→notification_provider_configs]
- `destination_masked` VARCHAR(100) [NOT NULL]
- `result` VARCHAR(10) [NOT NULL] — enum: SENT | FAILED
- `error_detail` VARCHAR(500)
- `sent_at` DATETIME(6) [NOT NULL]
**Relaciones:**
- → `notification_templates`: N:1 prueba de la plantilla
- → `users`: N:1 enviada al propio ADMIN
- → `notification_provider_configs`: N:1 con la configuración de proveedor

### ARC-147 · `sms_dispatch_queue` (table) · **transactional**
Cola de despacho de SMS con la configuración y el texto congelados, y respeto del rate limit y la franja horaria.
**Columnas:**
- `queue_id` CHAR(36) [PK, NOT NULL] — PK
- `step_id` CHAR(36) [FK→payment_reminder_steps] — nulo en los envíos de prueba
- `test_send_id` CHAR(36) [FK→template_test_sends]
- `sms_config_id` INT [FK→notification_provider_configs] — versión activa al encolar; nula en WAITING_CONFIG
- `template_id` INT [FK→notification_templates] — template_code y template_version congelados
- `rendered_body_encrypted` VARBINARY(1024) [NOT NULL] — texto congelado para los reintentos; sin datos de pago
- `destination_encrypted` VARBINARY(256) [NOT NULL] — E.164
- `destination_masked` VARCHAR(20) [NOT NULL]
- `queue_status` VARCHAR(20) [NOT NULL] — enum: QUEUED | WAITING_CONFIG | SENT | FAILED; nunca se descarta
- `not_before` DATETIME(6) — apertura de la franja
- `retry_count` TINYINT [NOT NULL] — <= max_retries de la versión encolada
- `enqueued_at` DATETIME(6) [NOT NULL]
- `sent_at` DATETIME(6)
**Relaciones:**
- → `payment_reminder_steps`: N:1 SMS del hito
- → `template_test_sends`: N:1 SMS del envío de prueba
- → `notification_provider_configs`: N:1 configuración SMS congelada
- → `notification_templates`: N:1 plantilla congelada

### ARC-148 · `nfc_readers` (table) · **catalog**
Inventario de lectores NFC registrados y autorizados a pedir decisiones de acceso.
**Columnas:**
- `reader_id` VARCHAR(50) [PK, NOT NULL] — PK [gap: inventario de lectores y sedes para la semilla]
- `display_name` VARCHAR(100) [NOT NULL]
- `location` VARCHAR(255) — sede o puerta
- `service_identity` VARCHAR(255) [NOT NULL] — identidad de servicio del lector [gap: mecanismo de autenticación]
- `is_active` TINYINT(1) [NOT NULL] — si está inactivo, 401
- `registered_at` DATETIME(6) [NOT NULL]

### ARC-149 · `nfc_credentials` (table) · **transactional**
Credenciales NFC ligadas a usuario y dispositivo, con la clave pública y su ciclo de revocación.
**Columnas:**
- `credential_id` CHAR(36) [PK, NOT NULL] — PK
- `user_id` CHAR(36) [NOT NULL, FK→users] — tomado de la sesión; como máximo una ACTIVE por usuario
- `device_id` VARCHAR(100) [NOT NULL]
- `platform` VARCHAR(10) [NOT NULL] — enum: IOS | ANDROID
- `device_public_key` TEXT [NOT NULL] — solo la clave pública [gap: algoritmo]
- `credential_status` VARCHAR(10) [NOT NULL] — enum: ACTIVE | REVOKED | EXPIRED; REVOKED es terminal
- `issued_at` DATETIME(6) [NOT NULL]
- `expires_at` DATETIME(6) [NOT NULL] — [gap: vigencia]
- `last_used_at` DATETIME(6)
- `revoked_at` DATETIME(6)
- `revoke_reason` VARCHAR(30) — enum: USER_REQUEST | DEVICE_REPLACED | ADMIN_LOST_STOLEN | PASSWORD_RESET | ACCOUNT_ANONYMIZED
- `revoked_by` VARCHAR(10) — enum: USER | ADMIN | SYSTEM
- `revoked_by_admin_id` CHAR(36) [FK→users]
- `revoke_comment` VARCHAR(500) — 10-500 caracteres; obligatorio si revoca un ADMIN
**Relaciones:**
- → `users`: N:1 credencial del usuario (y revocada por ADMIN)

### ARC-150 · `access_attempts` (table) · **event_log**
Registro append-only de los intentos de acceso NFC, con la decisión y la foto del estado de la suscripción.
**Columnas:**
- `attempt_id` CHAR(36) [PK, NOT NULL] — PK; append-only [pendiente: retención con el DPO]
- `reader_id` VARCHAR(50) [NOT NULL, FK→nfc_readers]
- `credential_id` CHAR(36) [FK→nfc_credentials] — nulo si la credencial es desconocida
- `user_id` CHAR(36) [FK→users]
- `reader_nonce_hash` CHAR(64) [NOT NULL] — UNIQUE (reader_id, reader_nonce_hash) anti-replay; el nonce nunca se expone
- `decision` VARCHAR(10) [NOT NULL] — enum: GRANTED | DENIED
- `deny_reason` VARCHAR(30) — obligatorio si DENIED y nulo si GRANTED; INVALID_CREDENTIAL | CREDENTIAL_REVOKED | CREDENTIAL_EXPIRED | REPLAY_DETECTED | NO_SUBSCRIPTION | SUBSCRIPTION_CANCELLED | SUBSCRIPTION_NOT_ACTIVE | ACCOUNT_NOT_ACTIVE | SERVICE_UNAVAILABLE
- `subscription_status_snapshot` VARCHAR(20) — leído en tiempo real, sin caché
- `attempted_at` DATETIME(6) [NOT NULL] — orden descendente en las consultas
- `response_ms` INT [NOT NULL] — objetivo p95 < 1000
**Relaciones:**
- → `nfc_readers`: N:1 leído por el lector
- → `nfc_credentials`: N:1 credencial presentada
- → `users`: N:1 titular del intento

## Requisitos que materializa esta tarea

### REQ-105 — Entrega a MOD-003 de la orden de devolución y reflejo en factura del resultado final notificado
El sistema entrega a MOD-003 la orden de devolución de la baja y refleja en la factura el resultado final que MOD-003 notifica.
**Reglas de negocio:**
1. El resultado de la devolución reflejado en la factura es el resultado final notificado por MOD-003
**Criterios de aceptación:**
1. AC-DEV-07: Dado un `invoice_refunds` en REEMBOLSO_PENDIENTE de 80 €, cuando se entrega a MOD-003 con `cancellation_id` como clave de idempotencia y la orden se acepta (o devuelve 409 por orden activa), entonces el estado pasa a REEMBOLSO_SOLICITADO con `refund_request_id` guardado, y MOD-003 recibe el `payment_method` del cobro original sin recalcular el importe.
2. AC-DEV-08: Dado una orden REEMBOLSO_SOLICITADO, cuando llega `RefundCompleted` o `RefundFailed`, entonces pasa a REEMBOLSADO o a REEMBOLSO_FALLIDO con `failure_code`. Un mensaje duplicado, tardío o con `refund_request_id` distinto no reabre un estado final y queda registrado.
3. AC-DEV-09: Dado que MOD-003 responde 5xx o timeout de forma sostenida, cuando se agotan los reintentos (1 / 5 / 15 / 60 min [inferido]), entonces ADMIN recibe una alerta, la orden sigue en REEMBOLSO_PENDIENTE y se reenvía al recuperarse el servicio sin perder ninguna orden. Ante un 422 `refund_method_mismatch`, la orden pasa a REEMBOLSO_FALLIDO con excepción para ADMIN.
4. AC-DEV-10: Dado el tráfico entre MOD-002 y MOD-003 y sus logs, cuando se audita una muestra de órdenes de devolución, entonces no aparece ningún token, PAN ni IBAN completo, y la llamada se autentica con identidad de servicio. [gap: mecanismo de autenticación entre módulos no declarado]
**Escenarios de error:**
1. Servicio de pagos y reembolsos no disponible al entregar la orden de devolución
2. Resultado notificado para una orden de devolución desconocida
3. Resultado notificado sobre una devolución ya cerrada con un resultado final distinto
**Campos de datos:**
- `original_invoice_id` (identifier, obligatorio) — Factura en la que se refleja el resultado
- `refund_order_id` (identifier, obligatorio) — Orden de devolución entregada a MOD-003
- `refund_final_result` (enum, opcional) — Valores no definidos en el requisito

## Entorno de prueba de esta sesión

NO se levanta ningún servicio de respaldo para esta tarea: verifica con tests unitarios y dobles en memoria. No intentes arrancar contenedores por tu cuenta ni asumas que hay una BBDD disponible.

Limitaciones declaradas:
- La tecnología `AsyncAPI` (capa `messaging`) no está en el catálogo de servicios de entorno: no hay contenedor equivalente para respaldar los eventos de `TSK-008`.
- La tecnología `AsyncAPI` (capa `messaging`) no está en el catálogo de servicios de entorno: no hay contenedor equivalente para respaldar los eventos de `TSK-014`.

## REWORK — feedback del revisor (atiéndelo TODO)
- (mind-platform) MIND (plataforma): este PR tiene **conflictos de merge** con `main` (`mergeable_state=dirty`). Suele pasar al mergear otro PR en paralelo que tocó ficheros compartidos (routers, `__init__`, deps…). Haz rebase o merge de `main` en tu rama, resuelve los conflictos sin cambiar el alcance de la tarea, deja build/tests verdes y vuelve a empujar. Preferible mergear PRs en orden del DAG (uno a uno) para reducir este caso.