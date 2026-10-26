'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { globSync } = require('glob');
const avsc = require('avsc');

const ROOT = path.resolve(__dirname, '..');

/** Lee y parsea un JSON del repo a partir de una ruta relativa a ROOT. */
function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

/** Campos del sobre canónico que deben sobrevivir al round-trip Avro. */
const ENVELOPE_FIELDS = ['event_id', 'event_type', 'timestamp', 'correlation_id'];

/**
 * Definiciones de evento de las que TSK-009 es dueña (los tres canales
 * gymusers.payments.*.v1). Las definiciones de otras tareas (facturación, …)
 * declaran su propio contrato y tienen su propio test: este no las invade.
 */
const OWNED_EVENTS = [
  'sources/events/payment_authorized.json',
  'sources/events/payment_failed.json',
  'sources/events/payment_processed.json',
];

const EVENT_FILES = globSync('sources/events/*.json', { cwd: ROOT })
  .map((file) => file.split(path.sep).join('/'))
  .filter((file) => OWNED_EVENTS.includes(file))
  .sort();

test('el glob encuentra las tres definiciones de evento de resultado de cobro', () => {
  assert.deepEqual(
    EVENT_FILES,
    OWNED_EVENTS,
    'glob vacío o incompleto: el test de publish de contrato sería vacuamente verde',
  );
});

for (const file of EVENT_FILES) {
  test(`${file}: el payload de ejemplo serializa contra su .avsc con el parser Avro`, () => {
    const def = readJson(file);

    assert.ok(
      def.payload && def.payload.example !== undefined && def.payload.example !== null,
      `${file}: falta payload.example; sin ejemplo no hay oráculo de publish de contrato`,
    );

    const type = avsc.Type.forSchema(readJson(def.payload_schema));

    assert.equal(
      type.isValid(def.payload.example),
      true,
      `${file}: payload.example no es válido contra ${def.payload_schema}`,
    );

    const buf = type.toBuffer(def.payload.example);
    assert.ok(Buffer.isBuffer(buf), `${file}: la serialización Avro no devolvió un Buffer`);
    assert.ok(buf.length > 0, `${file}: la serialización Avro devolvió un Buffer vacío`);

    const decoded = type.fromBuffer(buf);

    for (const field of ENVELOPE_FIELDS) {
      assert.deepEqual(
        decoded[field],
        def.payload.example[field],
        `${file}: el campo del sobre canónico ${field} no sobrevive al round-trip Avro`,
      );
    }

    for (const field of def.payload.required_fields) {
      assert.deepEqual(
        decoded[field],
        def.payload.example[field],
        `${file}: el campo requerido ${field} no sobrevive al round-trip Avro`,
      );
    }
  });
}

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

for (const file of EVENT_FILES) {
  test(`${file}: NEGATIVO — un payload sin user_id es rechazado por el parser Avro`, () => {
    const def = readJson(file);

    assert.ok(
      def.payload.required_fields.includes('user_id'),
      `${file}: user_id no figura en required_fields; los tres eventos de pago DEBEN llevar user_id`,
    );

    const broken = { ...def.payload.example };
    delete broken.user_id;

    const type = avsc.Type.forSchema(readJson(def.payload_schema));

    assert.equal(
      type.isValid(broken),
      false,
      `${file}: el parser Avro da por válido un payload sin user_id`,
    );

    assert.throws(
      () => type.toBuffer(broken),
      `${file}: un payload sin user_id no puede serializarse contra el contrato`,
    );
  });

  test(`${file}: NEGATIVO — las restricciones declaradas rechazan los valores fuera de contrato`, () => {
    const def = readJson(file);
    const constraints = def.payload.field_constraints || [];

    assert.ok(
      constraints.length >= 1,
      `${file}: payload.field_constraints vacío; el oráculo negativo sería vacuamente verde`,
    );

    for (const c of constraints) {
      if (Object.prototype.hasOwnProperty.call(def.payload.example, c.field)) {
        assert.equal(
          violatesConstraint(c, def.payload.example[c.field]),
          null,
          `${file}: el propio payload.example incumple la restricción declarada de ${c.field}`,
        );
      }

      if (c.minimum !== undefined) {
        assert.ok(
          violatesConstraint(c, 0) !== null,
          `${file}: ${c.field} <= 0 debe rechazarse: RN REQ-049 exige un entero positivo`,
        );
        assert.ok(
          violatesConstraint(c, -1) !== null,
          `${file}: ${c.field} <= 0 debe rechazarse: RN REQ-049 exige un entero positivo`,
        );
      }

      if (c.length !== undefined) {
        assert.ok(
          violatesConstraint(c, 'X'.repeat(c.length + 1)) !== null,
          `${file}: ${c.field} con longitud distinta de ${c.length} debe rechazarse`,
        );
      }

      if (c.pattern !== undefined) {
        for (const fuera of ['0.00', '-1.00', 'NO_CASA']) {
          assert.ok(
            violatesConstraint(c, fuera) !== null,
            `${file}: ${c.field} debe rechazar el valor ${fuera}, que no casa con el patrón declarado`,
          );
        }
      }

      if (c.enum !== undefined) {
        assert.ok(
          violatesConstraint(c, 'VALOR_FUERA_DE_CATALOGO') !== null,
          `${file}: ${c.field} debe rechazar un valor ajeno al catálogo declarado`,
        );
      }
    }
  });

  test(`${file}: un evento malformado se marca retryable: false en la definición (RN REQ-038)`, () => {
    const def = readJson(file);

    assert.ok(
      def.malformed_policy && typeof def.malformed_policy === 'object',
      `${file}: falta malformed_policy; RN REQ-038 exige declarar el tratamiento del evento malformado`,
    );

    assert.equal(
      def.malformed_policy.retryable,
      false,
      'RN REQ-038: un evento malformado NO es reintentable',
    );

    assert.ok(
      ['DEAD_LETTER', 'DISCARD', 'LOG_ONLY'].includes(def.malformed_policy.action),
      `${file}: malformed_policy.action debe ser DEAD_LETTER, DISCARD o LOG_ONLY y es ${JSON.stringify(def.malformed_policy.action)}`,
    );
  });
}
