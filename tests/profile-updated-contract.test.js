'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const avsc = require('avsc');

const ROOT = path.resolve(__dirname, '..');

/** Lee y parsea un fichero JSON (o .avsc) del repo a partir de una ruta relativa a ROOT. */
function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

/** Definición funcional del evento ProfileUpdated (EVT-015). */
const PROFILE_UPDATED_EVENT = 'sources/events/profile_updated.json';

/** Esquema Avro del payload de ProfileUpdated (EVT-015). */
const PROFILE_UPDATED_SCHEMA = 'sources/schemas/profile_updated.avsc';

/** Mapa pub/sub de ProfileUpdated: productor ARC-030, consumidores ARC-036 y ARC-031. */
const PROFILE_UPDATED_PUBSUB = 'sources/components/profile_updated_pubsub.json';

/** Canal de actualización de perfil (REQ-008, AC-PROF-02). */
const CHANNEL = 'gymusers.profile.updated.v1';

/**
 * Evalúa una restricción declarativa de payload.field_constraints contra un valor.
 * Devuelve el motivo del incumplimiento, o null si el valor cumple la restricción.
 */
function violatesConstraint(constraint, value) {
  if (constraint.type !== undefined) {
    if (constraint.type === 'integer') {
      if (!Number.isInteger(value)) {
        return `se esperaba un entero y llegó ${JSON.stringify(value)}`;
      }
    } else if (typeof value !== constraint.type) {
      return `se esperaba tipo ${constraint.type} y llegó ${typeof value}`;
    }
  }

  if (constraint.minimum !== undefined && !(value >= constraint.minimum)) {
    return `el valor ${JSON.stringify(value)} es menor que el mínimo ${constraint.minimum}`;
  }

  if (constraint.maximum !== undefined && !(value <= constraint.maximum)) {
    return `el valor ${JSON.stringify(value)} supera el máximo ${constraint.maximum}`;
  }

  if (constraint.length !== undefined && String(value).length !== constraint.length) {
    return `la longitud debe ser exactamente ${constraint.length} y es ${String(value).length}`;
  }

  if (constraint.pattern !== undefined && !new RegExp(constraint.pattern).test(value)) {
    return `el valor ${JSON.stringify(value)} no casa con el patrón ${constraint.pattern}`;
  }

  if (constraint.enum !== undefined && !constraint.enum.includes(value)) {
    return `el valor ${JSON.stringify(value)} no pertenece al catálogo ${JSON.stringify(constraint.enum)}`;
  }

  return null;
}

/**
 * Valida un payload de ProfileUpdated contra el contrato COMPLETO (definición + Avro) y devuelve
 * la lista de motivos de rechazo (array vacío = payload válido).
 *
 * El primer control (campo no declarado) es imprescindible: avsc ignora POR DISEÑO las claves
 * sobrantes en type.isValid(), así que un payload con `nick` pasaría el esquema Avro y el test
 * sería una señal falsa. AC-PROF-03 exige que el nick no viaje nunca en la actualización de perfil.
 */
function validateProfilePayload(def, type, payload) {
  const reasons = [];
  const required = def.payload.required_fields || [];
  const optional = def.payload.optional_fields || [];
  const declared = [...required, ...optional];

  for (const key of Object.keys(payload)) {
    if (!declared.includes(key)) {
      reasons.push(
        `campo no declarado en el contrato: "${key}" no figura ni en required_fields ni en optional_fields de ${PROFILE_UPDATED_EVENT}`,
      );
    }
  }

  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(payload, field) || payload[field] === undefined) {
      reasons.push(`campo obligatorio ausente: "${field}" es requerido por el contrato de ${CHANNEL}`);
    }
  }

  if (type.isValid(payload) !== true) {
    reasons.push(`el payload no valida contra el esquema Avro ${PROFILE_UPDATED_SCHEMA}`);
  }

  for (const constraint of def.payload.field_constraints || []) {
    if (!Object.prototype.hasOwnProperty.call(payload, constraint.field)) {
      continue;
    }
    const motivo = violatesConstraint(constraint, payload[constraint.field]);
    if (motivo !== null) {
      reasons.push(`restricción incumplida en "${constraint.field}": ${motivo}`);
    }
  }

  return reasons;
}

test('REQ-008 / AC-PROF-02: el payload de ejemplo completo es válido contra profile_updated.avsc', () => {
  const def = readJson(PROFILE_UPDATED_EVENT);

  assert.ok(
    def.payload && def.payload.example,
    `${PROFILE_UPDATED_EVENT}: payload.example es obligatorio; sin un perfil actualizado de ejemplo el contrato de ${CHANNEL} no es verificable (AC-PROF-02)`,
  );

  const type = avsc.Type.forSchema(readJson(def.payload_schema));

  assert.equal(
    type.isValid(def.payload.example),
    true,
    `${def.payload_schema}: el perfil actualizado de ejemplo declarado en ${PROFILE_UPDATED_EVENT} debe ser válido contra el esquema Avro; si no lo es, ARC-030 no podría publicar ni un solo evento de perfil (REQ-008)`,
  );

  assert.deepEqual(
    validateProfilePayload(def, type, def.payload.example),
    [],
    `${PROFILE_UPDATED_EVENT}: el propio payload.example debe superar el contrato completo (campos declarados + obligatorios + Avro + field_constraints); si el ejemplo de referencia ya incumple el contrato, los consumidores ARC-036 y ARC-031 recibirían perfiles inválidos (AC-PROF-02)`,
  );

  const decoded = type.fromBuffer(type.toBuffer(def.payload.example));

  for (const field of def.payload.required_fields) {
    assert.deepEqual(
      decoded[field],
      def.payload.example[field],
      `${def.payload_schema}: el campo obligatorio ${field} no sobrevive al round-trip Avro (toBuffer/fromBuffer); un perfil que pierde datos al serializar llegaría incompleto a ARC-036 y ARC-031 y dejaría al socio con datos desactualizados (REQ-008)`,
    );
  }
});

test('AC-PROF-03: NEGATIVO — un payload que incluye nick es rechazado por el contrato', () => {
  const def = readJson(PROFILE_UPDATED_EVENT);
  const type = avsc.Type.forSchema(readJson(def.payload_schema));

  const conNick = { ...def.payload.example, nick: 'lucia_fo' };
  const reasons = validateProfilePayload(def, type, conNick);

  assert.ok(
    reasons.length >= 1,
    `${PROFILE_UPDATED_EVENT}: un payload con "nick" debe ser rechazado por el contrato; el nick es inmutable (AC-PROF-03) y por eso no viaja nunca como cambio en ProfileUpdated`,
  );
  assert.ok(
    reasons.some((motivo) => motivo.includes('nick')),
    `${PROFILE_UPDATED_EVENT}: se esperaba un motivo de rechazo que mencionase "nick", pero se obtuvo: ${JSON.stringify(reasons)} (AC-PROF-03)`,
  );

  assert.ok(
    !(def.payload.required_fields || []).includes('nick'),
    `${PROFILE_UPDATED_EVENT}: "nick" no puede figurar en payload.required_fields — es inmutable y no editable (AC-PROF-03)`,
  );
  assert.ok(
    !(def.payload.optional_fields || []).includes('nick'),
    `${PROFILE_UPDATED_EVENT}: "nick" no puede figurar en payload.optional_fields — es inmutable y no editable (AC-PROF-03)`,
  );

  const avroFields = readJson(def.payload_schema).fields.map((f) => f.name);
  for (const prohibido of ['nick', 'password_hash']) {
    assert.ok(
      !avroFields.includes(prohibido),
      `${def.payload_schema}: el record Avro declara el campo "${prohibido}", que no debe viajar nunca en ProfileUpdated (el nick es inmutable por AC-PROF-03; password_hash es una credencial que no sale del módulo de identidad ARC-030). Campos declarados: ${avroFields.join(', ')}`,
    );
  }
});

test('REQ-008: NEGATIVO — una edad fuera de 18-120 es rechazada por el contrato', () => {
  const def = readJson(PROFILE_UPDATED_EVENT);
  const type = avsc.Type.forSchema(readJson(def.payload_schema));
  const example = def.payload.example;

  const ageConstraint = (def.payload.field_constraints || []).find((c) => c.field === 'age');
  assert.ok(
    ageConstraint,
    `${PROFILE_UPDATED_EVENT}: falta la restricción de "age" en payload.field_constraints; sin ella el oráculo del rango 18-120 (REQ-008) sería inejecutable y este test daría una señal falsa`,
  );
  assert.equal(
    ageConstraint.minimum,
    18,
    `${PROFILE_UPDATED_EVENT}: la restricción de "age" debe declarar minimum: 18 (REQ-008, validación 5) y declara ${JSON.stringify(ageConstraint.minimum)}`,
  );
  assert.equal(
    ageConstraint.maximum,
    120,
    `${PROFILE_UPDATED_EVENT}: la restricción de "age" debe declarar maximum: 120 (REQ-008, validación 5) y declara ${JSON.stringify(ageConstraint.maximum)}`,
  );

  for (const edad of [17, 0, 121, 200]) {
    const reasons = validateProfilePayload(def, type, { ...example, age: edad });
    assert.ok(
      reasons.length >= 1,
      `${PROFILE_UPDATED_EVENT}: la edad ${edad} está fuera del rango 18-120 y debe ser rechazada por el contrato; si se publicase, ARC-036 y ARC-031 recibirían un perfil que la tabla users de T.5 nunca habría aceptado (REQ-008)`,
    );
    assert.ok(
      reasons.some((motivo) => motivo.includes('age')),
      `${PROFILE_UPDATED_EVENT}: se esperaba un motivo de rechazo que mencionase "age" para la edad ${edad}, pero se obtuvo: ${JSON.stringify(reasons)} (REQ-008)`,
    );
  }

  for (const edad of [18, 34, 120]) {
    assert.deepEqual(
      validateProfilePayload(def, type, { ...example, age: edad }),
      [],
      `${PROFILE_UPDATED_EVENT}: la edad ${edad} está dentro del rango permitido 18-120 (límites INCLUSIVE) y debe aceptarse; rechazarla impediría al socio actualizar un perfil legítimo (REQ-008)`,
    );
  }
});

test('AC-PROF-02: el mapa pub/sub resuelve los tres componentes del canal', () => {
  const component = readJson(PROFILE_UPDATED_PUBSUB);
  const eventDef = readJson(PROFILE_UPDATED_EVENT);

  assert.equal(
    component.channel,
    CHANNEL,
    `${PROFILE_UPDATED_PUBSUB}: el mapa pub/sub debe declarar el canal ${CHANNEL} (AC-PROF-02)`,
  );

  for (const evt of component.events) {
    assert.equal(
      evt.topic,
      CHANNEL,
      `${PROFILE_UPDATED_PUBSUB}: la entrada de ${evt.component} publica/consume en el topic "${evt.topic}" en vez de ${CHANNEL}; un topic distinto rompe la resolución del canal (AC-PROF-02)`,
    );
    assert.equal(
      evt.event_code,
      'EVT-015',
      `${PROFILE_UPDATED_PUBSUB}: la entrada de ${evt.component} declara event_code "${evt.event_code}" en vez de EVT-015 (ProfileUpdated)`,
    );
  }

  const publishers = component.events.filter((e) => e.operation === 'publish');
  assert.equal(
    publishers.length,
    1,
    `${PROFILE_UPDATED_PUBSUB}: el canal ${CHANNEL} debe tener EXACTAMENTE UN productor y declara ${publishers.length} (${publishers.map((p) => p.component).join(', ')}); dos productores del mismo evento duplicarían las actualizaciones de perfil (AC-PROF-02)`,
  );
  assert.equal(
    publishers[0].component,
    'ARC-030',
    `${PROFILE_UPDATED_PUBSUB}: el único productor de ProfileUpdated debe ser ARC-030 (Identidad y sesiones), no ${publishers[0].component}`,
  );
  assert.equal(
    publishers[0].component,
    eventDef.producer,
    `${PROFILE_UPDATED_PUBSUB}: el productor del mapa pub/sub (${publishers[0].component}) no coincide con el producer declarado en ${PROFILE_UPDATED_EVENT} (${eventDef.producer}); el mapa y la definición del evento describirían arquitecturas distintas`,
  );

  const subscribers = component.events
    .filter((e) => e.operation === 'subscribe')
    .map((e) => e.component)
    .sort();
  assert.deepEqual(
    subscribers,
    ['ARC-031', 'ARC-036'],
    `${PROFILE_UPDATED_PUBSUB}: los consumidores de ${CHANNEL} deben ser exactamente ARC-031 (Suscripciones y facturación) y ARC-036 (Avisos de impago), y son ${JSON.stringify(subscribers)} (AC-PROF-02)`,
  );
  assert.deepEqual(
    subscribers,
    [...eventDef.consumers].sort(),
    `${PROFILE_UPDATED_PUBSUB}: los suscriptores del mapa ${JSON.stringify(subscribers)} no coinciden con los consumers de ${PROFILE_UPDATED_EVENT} ${JSON.stringify(eventDef.consumers)}; un consumidor declarado en un sitio y no en el otro no recibiría el perfil actualizado`,
  );

  for (const evt of component.events.filter((e) => e.operation === 'subscribe')) {
    assert.deepEqual(
      evt.idempotency_key,
      ['user_id', 'updated_at'],
      `${PROFILE_UPDATED_PUBSUB}: el suscriptor ${evt.component} debe declarar idempotency_key ["user_id","updated_at"] y declara ${JSON.stringify(evt.idempotency_key)}; sin ella un reintento desde event_outbox aplicaría dos veces la misma actualización (AC-PROF-02)`,
    );
  }
  assert.deepEqual(
    component.idempotency_key,
    ['user_id', 'updated_at'],
    `${PROFILE_UPDATED_PUBSUB}: la raíz del componente debe declarar idempotency_key ["user_id","updated_at"] y declara ${JSON.stringify(component.idempotency_key)}`,
  );

  for (const field of ['user_id', 'updated_at']) {
    assert.ok(
      eventDef.payload.required_fields.includes(field),
      `${PROFILE_UPDATED_EVENT}: el campo "${field}" forma la clave de idempotencia pero NO es obligatorio en payload.required_fields; una clave de idempotencia sobre un campo opcional o inexistente no deduplica nada y los consumidores reprocesarían el evento (AC-PROF-02)`,
    );
  }
});

test('AC-PROF-02: NEGATIVO — un componente cuyo canal no existe no se resuelve', () => {
  const { globSync } = require('glob');

  const topics = new Set();
  const eventFiles = globSync('sources/events/*.json', { cwd: ROOT });
  assert.ok(
    eventFiles.length >= 1,
    'sources/events/*.json no devolvió ningún fichero: el conjunto de topics estaría vacío y la resolución del canal sería vacuamente verde',
  );
  for (const file of eventFiles) {
    const def = readJson(file);
    if (typeof def.topic === 'string' && def.topic.length > 0) {
      topics.add(def.topic);
    }
  }

  assert.ok(
    topics.has(CHANNEL),
    `el canal entregado ${CHANNEL} debe resolverse contra algún sources/events/*.json con ese topic; declarados: ${[...topics].join(', ')} (AC-PROF-02)`,
  );

  const yaml = fs.readFileSync(path.join(ROOT, 'asyncapi.yaml'), 'utf8');
  assert.ok(
    yaml.includes(`${CHANNEL}:`),
    `asyncapi.yaml no publica el canal ${CHANNEL}; el contrato AsyncAPI que consumen ARC-036 y ARC-031 no incluiría la actualización de perfil (AC-PROF-02)`,
  );
  assert.ok(
    yaml.includes('ProfileUpdated'),
    'asyncapi.yaml no menciona el mensaje ProfileUpdated (EVT-015); el canal estaría publicado sin mensaje asociado (AC-PROF-02)',
  );

  const clon = { ...readJson(PROFILE_UPDATED_PUBSUB), channel: 'gymusers.profile.updated.v99' };
  assert.equal(
    topics.has(clon.channel),
    false,
    `el canal huérfano "${clon.channel}" NO debe resolverse contra sources/events/*.json; si resolviese, la validación de canales aceptaría componentes apuntando a topics inexistentes y el evento se perdería en silencio (AC-PROF-02)`,
  );
});
