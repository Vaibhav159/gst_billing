import { toSaleProduct } from './products';
import { rateKey } from '@/core/rates/model';
import { RING } from './testing';

test('4C shared product mapper preserves X-13 fields before 5C consumes them', () => {
  const product = toSaleProduct({ ...RING, kind: null, kind_effective: 'gold', purity: '22K' });
  expect(product).toMatchObject({ kind: null, kind_effective: 'gold', purity: '22K' });
  expect(rateKey(product)).toBe('gold-22K');
});
