'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { globSync } = require('glob');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');

const COMPONENT_SCHEMA = '.config/schemas/component-definition.schema.json';
const INVALID_COMPONENT_FIXTURE = 'tests/fixtures/invalid/component_without_channel.json';
const VALID_ROLES = ['producer', 'consumer', 'producer-consumer'];

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

function buildValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(readJson(COMPONENT_SCHEMA));
}

function declaredTopics() {
  const topics = new Set();
  for (const file of globSync('sources/events/*.json', { cwd: ROOT })) {
    const def = readJson(file);
    if (typeof def.topic === 'string' && def.topic.length > 0) {
      topics.add(def.topic);
    }
  }
  return topics;
}

const COMPONENT_FILES = globSync('sources/components/*.json', { cwd: ROOT }).sort();

test('el glob sources/components/*.json encuentra al menos una definición de componente', () => {
  assert.ok(COMPONENT_FILES.length >= 1, 'glob vacío: la validación sería vacuamente verde');
});

for (const file of COMPONENT_FILES) {
  test(`${file} valida contra component-definition.schema.json`, () => {
    const validate = buildValidator();
    const def = readJson(file);
    const valid = validate(def);
    assert.equal(
      valid,
      true,
      `${file} no valida contra el esquema: ${JSON.stringify(validate.errors)}`
    );
  });

  test(`${file} declara channel, role y al menos un evento`, () => {
    const def = readJson(file);

    assert.equal(typeof def.channel, 'string', `${file}: channel debe ser una cadena`);
    assert.ok(def.channel.trim().length > 0, `${file}: channel no puede estar vacío`);

    assert.ok(
      VALID_ROLES.includes(def.role),
      `${file}: role "${def.role}" no es uno de ${VALID_ROLES.join(', ')}`
    );

    assert.ok(Array.isArray(def.events), `${file}: events debe ser un array`);
    assert.ok(def.events.length >= 1, `${file}: events debe declarar al menos un evento`);
  });

  test(`${file} declara canales que existen en sources/events/*.json`, () => {
    const def = readJson(file);
    const topics = declaredTopics();

    assert.ok(
      topics.has(def.channel),
      `${file}: canal huérfano "${def.channel}" — no hay ninguna definición en sources/events/*.json con ese topic (declarados: ${[...topics].join(', ')})`
    );

    for (const evt of def.events) {
      assert.ok(
        topics.has(evt.topic),
        `${file}: canal huérfano "${evt.topic}" del evento ${evt.event_code} — no hay ninguna definición en sources/events/*.json con ese topic (declarados: ${[...topics].join(', ')})`
      );
    }
  });

  test(`${file} usa operaciones coherentes con su rol`, () => {
    const def = readJson(file);
    const allowedByRole = {
      producer: ['publish'],
      consumer: ['subscribe'],
      'producer-consumer': ['publish', 'subscribe']
    };
    const allowed = allowedByRole[def.role];

    assert.ok(Array.isArray(allowed), `${file}: role "${def.role}" desconocido`);

    for (const evt of def.events) {
      assert.ok(
        allowed.includes(evt.operation),
        `${file}: el evento ${evt.event_code} usa operation "${evt.operation}", incoherente con role "${def.role}" (se admite: ${allowed.join(', ')})`
      );
    }
  });
}

test('NEGATIVO: una definición de componente sin channel DEBE fallar la validación', () => {
  const validate = buildValidator();
  const doc = readJson(INVALID_COMPONENT_FIXTURE);

  assert.equal(validate(doc), false, 'un fichero inválido no puede pasar la validación');

  const errors = validate.errors || [];
  const mentionsChannel = errors.some((err) => JSON.stringify(err).includes('channel'));
  assert.ok(
    mentionsChannel,
    `se esperaba un error de validación que mencionase "channel", pero se obtuvo: ${JSON.stringify(errors)}`
  );
});
