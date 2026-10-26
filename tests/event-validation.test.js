'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { globSync } = require('glob');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const avsc = require('avsc');

const ROOT = path.resolve(__dirname, '..');

const EVENT_DEFINITION_SCHEMA = '.config/schemas/event-definition.schema.json';
const ENVELOPE_SCHEMA = 'sources/schemas/common/event_envelope.avsc';

/** Lee y parsea un JSON del repo a partir de una ruta relativa a ROOT. */
function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

/** Compila el validador de definiciones de evento (el MISMO para positivos y negativos). */
function buildValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(readJson(EVENT_DEFINITION_SCHEMA));
}

/** Nombres de campo prohibidos por PCI/GDPR (PAN, CVV, tokens, IBAN completo). */
const FORBIDDEN =
  /^(pan|card_?number|full_pan|card_pan|cvv2?|cvc2?|security_code|token|card_token|access_token|refresh_token|auth_token|api_?key|iban|full_iban|bank_account_number|account_number)$/i;

/**
 * Recorre recursivamente un valor JSON y devuelve un Set con TODAS las claves de
 * objeto y TODOS los valores string que aparezcan bajo una clave `name`.
 * La subrama `payload_constraints` se excluye (ahí viven reglas, no nombres de campo).
 */
function collectNames(value, names = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNames(item, names);
    }
    return names;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      names.add(key);
      if (key === 'payload_constraints') {
        continue;
      }
      if (key === 'name' && typeof child === 'string') {
        names.add(child);
      }
      collectNames(child, names);
    }
  }
  return names;
}

/** Nombres de los campos de primer nivel del record Avro indicado. */
function avroFieldNames(relAvscPath) {
  return avsc.Type.forSchema(readJson(relAvscPath)).fields.map((f) => f.name);
}

const EVENT_FILES = globSync('sources/events/*.json', { cwd: ROOT }).sort();

test('el glob sources/events/*.json encuentra al menos una definición de evento', () => {
  assert.ok(EVENT_FILES.length >= 1, 'glob vacío: la validación sería vacuamente verde');
});

for (const file of EVENT_FILES) {
  test(`${file} valida contra event-definition.schema.json`, () => {
    const validate = buildValidator();
    const def = readJson(file);
    const valid = validate(def);
    assert.equal(valid, true, `${file} no valida: ${JSON.stringify(validate.errors)}`);
  });

  test(`${file} declara topic, version, payload_schema y delivery completa`, () => {
    const def = readJson(file);

    assert.equal(typeof def.topic, 'string', `${file}: topic debe ser string`);
    assert.ok(def.topic.trim().length > 0, `${file}: topic no puede estar vacío`);

    assert.ok(Number.isInteger(def.version), `${file}: version debe ser un entero`);
    assert.ok(def.version >= 1, `${file}: version debe ser >= 1`);

    assert.equal(typeof def.payload_schema, 'string', `${file}: payload_schema debe ser string`);
    assert.ok(def.payload_schema.trim().length > 0, `${file}: payload_schema no puede estar vacío`);

    assert.ok(
      def.delivery !== null && typeof def.delivery === 'object',
      `${file}: delivery debe ser un objeto`,
    );
    assert.ok(
      Number.isInteger(def.delivery.retries),
      `${file}: delivery.retries debe ser un entero`,
    );
    assert.ok(
      def.delivery.backoff !== null && typeof def.delivery.backoff === 'object',
      `${file}: delivery.backoff debe estar declarado`,
    );
    assert.equal(
      typeof def.delivery.timeout_s,
      'number',
      `${file}: delivery.timeout_s debe ser un número`,
    );
    assert.ok(def.delivery.timeout_s > 0, `${file}: delivery.timeout_s debe ser > 0`);
  });

  test(`${file} apunta a un payload_schema .avsc que existe en disco`, () => {
    const def = readJson(file);
    assert.ok(
      fs.existsSync(path.join(ROOT, def.payload_schema)),
      `${file}: payload_schema inexistente en disco: ${def.payload_schema}`,
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, def.envelope_schema)),
      `${file}: envelope_schema inexistente en disco: ${def.envelope_schema}`,
    );
  });

  test(`${file} declara los cuatro campos del sobre canónico y todos existen en su .avsc`, () => {
    const def = readJson(file);

    const envelopeFields = avroFieldNames(ENVELOPE_SCHEMA);
    assert.equal(
      envelopeFields.length,
      4,
      `${ENVELOPE_SCHEMA} debe declarar exactamente 4 campos, tiene ${envelopeFields.length}`,
    );

    const requiredFields = def.payload.required_fields;
    const missingEnvelope = envelopeFields.filter((name) => !requiredFields.includes(name));
    assert.deepEqual(
      missingEnvelope,
      [],
      `${file}: faltan campos del sobre canónico en payload.required_fields: ${missingEnvelope.join(', ')}`,
    );

    const payloadFields = avroFieldNames(def.payload_schema);
    const declared = [...requiredFields, ...(def.payload.optional_fields || [])];
    const missingInAvro = declared.filter((name) => !payloadFields.includes(name));
    assert.deepEqual(
      missingInAvro,
      [],
      `${file}: campos declarados que no existen en ${def.payload_schema}: ${missingInAvro.join(', ')}`,
    );
  });

  test(`${file} no expone PAN, CVV, token ni IBAN completo`, () => {
    const def = readJson(file);

    const candidates = [...collectNames(def), ...avroFieldNames(def.payload_schema)];
    const offenders = candidates.filter((name) => FORBIDDEN.test(name));

    assert.deepEqual(
      offenders,
      [],
      `${file}: nombres prohibidos por PCI/GDPR: ${offenders.join(', ')}`,
    );
  });
}

test('NEGATIVO: una definición de evento sin event_id en el payload DEBE fallar la validación', () => {
  const validate = buildValidator();
  const doc = readJson('tests/fixtures/invalid/event_without_event_id.json');

  assert.equal(validate(doc), false, 'un fichero inválido no puede pasar la validación');

  const mentionsEventId = (validate.errors || []).some((err) =>
    JSON.stringify(err).includes('event_id'),
  );
  assert.ok(
    mentionsEventId,
    `ningún error menciona event_id: ${JSON.stringify(validate.errors)}`,
  );
});

test('NEGATIVO: una definición de evento con un campo de PAN en el payload DEBE fallar la validación', () => {
  const validate = buildValidator();
  const doc = readJson('tests/fixtures/invalid/event_with_pan.json');

  assert.equal(validate(doc), false, 'un fichero inválido no puede pasar la validación');
});
