const payoutService = require('../src/services/payout.service');

async function test() {
  const mockClaim = {
    id: '00000000-0000-0000-0000-000000000001',
    status: 'approved',
    approved_payout: 120,
    trigger_event_id: '00000000-0000-0000-0000-000000000002',
  };
  const mockRider = {
    id: '37dc45aa-37ac-43db-aa60-28cf81dd2b8f',
    mobile: '9876543210',
  };

  // Test 1 — valid approved claim
  // NOTE: This will fail at DB update since claim ID
  // doesn't exist — that's expected, test the error handling
  const result = await payoutService.initiatePayout(mockClaim, mockRider);
  console.log('Payout result:', result);

  // Test 2 — non-approved claim
  const badClaim = { ...mockClaim, status: 'flagged' };
  const result2 = await payoutService.initiatePayout(badClaim, mockRider);
  console.assert(
    result2.success === false,
    'Non-approved claim must fail',
  );
  console.assert(
    result2.reason === 'claim_not_approved',
    'Reason must be claim_not_approved',
  );
  console.log(
    'Non-approved claim correctly rejected:',
    result2.reason,
  );

  console.log('Payout service tests done.');
}
test().catch(console.error);

