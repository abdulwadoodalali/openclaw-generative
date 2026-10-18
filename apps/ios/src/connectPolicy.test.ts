// @ts-nocheck
// Tests run under Node with --experimental-strip-types; no @types/node in this Expo project.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SIMULATOR_URL,
  decideStartup,
  isRepairCode,
  isRepairPairingReason,
  repairNeedsFreshIdentity,
  defaultGatewayUrl,
  pairingCommands,
} from './connectPolicy.ts';

describe('defaultGatewayUrl', () => {
  it('uses the configured gateway URL', () => {
    assert.strictEqual(defaultGatewayUrl('wss://my-mac.example-tailnet.ts.net'), 'wss://my-mac.example-tailnet.ts.net');
    assert.strictEqual(defaultGatewayUrl(' ws://10.0.0.5:18789 '), 'ws://10.0.0.5:18789');
  });
  it('falls back to loopback when nothing is configured', () => {
    assert.strictEqual(defaultGatewayUrl(), 'ws://127.0.0.1:18789');
    assert.strictEqual(defaultGatewayUrl(null), SIMULATOR_URL);
    assert.strictEqual(defaultGatewayUrl('  '), SIMULATOR_URL);
  });
});

describe('decideStartup', () => {
  it('auto-connects with a stored device token alone', () => {
    assert.strictEqual(decideStartup({ hasDeviceToken: true, hasGatewayToken: false }), 'auto-connect');
  });
  it('auto-connects with a gateway token alone (pairing still pending)', () => {
    assert.strictEqual(decideStartup({ hasDeviceToken: false, hasGatewayToken: true }), 'auto-connect');
  });
  it('auto-connects with both', () => {
    assert.strictEqual(decideStartup({ hasDeviceToken: true, hasGatewayToken: true }), 'auto-connect');
  });
  it('pairs automatically when nothing is stored (Settings only opens if that fails)', () => {
    assert.strictEqual(decideStartup({ hasDeviceToken: false, hasGatewayToken: false }), 'auto-pair');
  });
});

describe('isRepairCode', () => {
  it('re-pairs on the codes PAIRING.md section 7 lists', () => {
    for (const c of ['AUTH_TOKEN_MISMATCH', 'AUTH_DEVICE_TOKEN_MISMATCH', 'AUTH_SCOPE_MISMATCH', 'NOT_PAIRED', 'DEVICE_AUTH_SIGNATURE_INVALID', 'DEVICE_AUTH_NONCE_MISMATCH']) {
      assert.strictEqual(isRepairCode(c), true, c);
    }
  });
  it('does not re-pair on outages, rate limits or a missing token', () => {
    for (const c of ['UNAVAILABLE', 'AUTH_RATE_LIMITED', 'AUTH_TOKEN_MISSING', 'PAIRING_REQUIRED', '', undefined, null]) {
      assert.strictEqual(isRepairCode(c), false, String(c));
    }
  });
});

describe('pairingCommands', () => {
  it('lists then approves the exact request id', () => {
    assert.deepStrictEqual(pairingCommands('abc-123'), ['openclaw devices list', 'openclaw devices approve abc-123']);
  });
  it('falls back to a placeholder', () => {
    assert.strictEqual(pairingCommands()[1], 'openclaw devices approve <id>');
  });
});

describe('isRepairPairingReason', () => {
  it('re-pairs when the Mac forgot the device or the grant shrank, not on role upgrades', () => {
    assert.strictEqual(isRepairPairingReason('not-paired'), true);
    assert.strictEqual(isRepairPairingReason('scope-upgrade'), true);
    assert.strictEqual(isRepairPairingReason('role-upgrade'), false);
    assert.strictEqual(isRepairPairingReason('metadata-upgrade'), false);
    assert.strictEqual(isRepairPairingReason(undefined), false);
  });
});

describe('repairNeedsFreshIdentity', () => {
  it('abandons the old device id only when the Mac forgot the device', () => {
    assert.strictEqual(repairNeedsFreshIdentity('NOT_PAIRED'), true);
    assert.strictEqual(repairNeedsFreshIdentity('AUTH_TOKEN_MISMATCH'), false);
    assert.strictEqual(repairNeedsFreshIdentity(undefined), false);
  });
});
