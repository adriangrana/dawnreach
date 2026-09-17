import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  authoredWorldEntityName,
  matchEventKindFromEntityId,
  matchEventLabelForEntityId,
  matchEventTeamFromEntityId,
} = require('../node_modules/.cache/alden-test/match/matchEventParticipants.js');

test('generated tower ids never leak runtime prefixes or UUIDs into match presentation', () => {
  const id = 'tower:red-mid-tower:70f838ce-96a4-48bd-9e3b-53e3c4fbce20';
  assert.equal(authoredWorldEntityName(id), 'red-mid-tower');
  assert.equal(matchEventTeamFromEntityId(id), 'red');
  assert.equal(matchEventKindFromEntityId(id), 'tower');
  assert.equal(matchEventLabelForEntityId(id, 'tower'), 'Torre central');
});

test('tower labels preserve lane semantics and support future inner/outer tower ids', () => {
  assert.equal(matchEventLabelForEntityId('blue-top-tower', 'tower'), 'Torre superior');
  assert.equal(matchEventLabelForEntityId('red-bot-tower', 'tower'), 'Torre inferior');
  assert.equal(matchEventLabelForEntityId('tower:blue-mid-inner-tower:any-uuid', 'tower'), 'Torre central interior');
  assert.equal(matchEventLabelForEntityId('tower:red-mid-outer-tower:any-uuid', 'tower'), 'Torre central exterior');
});

test('existing stable hero ids keep their team, kind and readable hero name', () => {
  const id = 'blue-hero-alden';
  assert.equal(matchEventTeamFromEntityId(id), 'blue');
  assert.equal(matchEventKindFromEntityId(id), 'hero');
  assert.equal(matchEventLabelForEntityId(id, 'hero'), 'Alden');
});
