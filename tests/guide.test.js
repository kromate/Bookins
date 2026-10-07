import test from 'node:test'
import assert from 'node:assert/strict'
import { demoGuideRoutes, demoGuideSteps, liveGuideRoutes, liveGuideSteps } from '../demo/guide.js'
import { createWalkthrough } from '../demo/useWalkthrough.js'

const noop = async () => {}

test('every Live tour step targets a registered route (the tour must not throw at setup)', () => {
  for (const step of liveGuideSteps)
    assert.ok(liveGuideRoutes.includes(step.route), `step "${step.id}" uses unregistered route ${step.route}`)
  assert.doesNotThrow(() => createWalkthrough({ steps: liveGuideSteps, routes: [...liveGuideRoutes], navigate: noop }))
})

test('every Demo tour step targets a registered route (the tour must not throw at setup)', () => {
  for (const step of demoGuideSteps)
    assert.ok(demoGuideRoutes.includes(step.route), `step "${step.id}" uses unregistered route ${step.route}`)
  assert.doesNotThrow(() => createWalkthrough({ steps: demoGuideSteps, routes: [...demoGuideRoutes], navigate: noop }))
})

test('registered route lists contain no duplicates or unused routes', () => {
  for (const [name, routes, steps] of [['Live', liveGuideRoutes, liveGuideSteps], ['Demo', demoGuideRoutes, demoGuideSteps]]) {
    assert.equal(new Set(routes).size, routes.length, `${name} routes repeat`)
    for (const route of routes) assert.ok(steps.some(step => step.route === route), `${name} route ${route} has no step`)
  }
})

test('step ids are unique and Live target anchors are unique', () => {
  for (const steps of [liveGuideSteps, demoGuideSteps]) assert.equal(new Set(steps.map(step => step.id)).size, steps.length)
  const targets = liveGuideSteps.map(step => step.targetId)
  assert.ok(targets.every(Boolean), 'every Live step needs a targetId')
  assert.equal(new Set(targets).size, targets.length, 'Live targetIds must be unique')
})

test('the Demo tour stays short and covers Messages, Team and Campaigns', () => {
  assert.ok(demoGuideSteps.length <= 8, `Demo tour has ${demoGuideSteps.length} steps`)
  for (const route of ['/messages', '/team', '/campaigns']) assert.ok(demoGuideSteps.some(step => step.route === route), `Demo tour lacks ${route}`)
})

test('the Live tour registers every owner navigation page', () => {
  const owner = ['/', '/services', '/availability', '/bookings', '/messages', '/team', '/campaigns', '/contacts', '/insights', '/settings']
  for (const route of owner) assert.ok(liveGuideRoutes.includes(route), `Live tour lacks ${route}`)
})
