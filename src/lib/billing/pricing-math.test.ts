import test from 'node:test';
import assert from 'node:assert/strict';

import { estimateCreditsFromRuleMath } from './pricing-math';

test('image estimate scales with count and resolution', () => {
  const credits = estimateCreditsFromRuleMath(
    {
      baseCredits: 8,
      tierMultiplier: 1,
      resolutionMultiplier: { default: 1, '4K': 2 },
    },
    {
      operationType: 'image.generate',
      imageCount: 3,
      resolution: '4K',
    }
  );

  assert.equal(credits, 48);
});

test('video estimate uses per-second credits and rounds up', () => {
  const credits = estimateCreditsFromRuleMath(
    {
      baseCredits: 10,
      perSecondCredits: 35,
      tierMultiplier: 1.2,
      resolutionMultiplier: { default: 1.1 },
    },
    {
      operationType: 'video.generate',
      durationSeconds: 6,
    }
  );

  assert.equal(credits, 291);
});
