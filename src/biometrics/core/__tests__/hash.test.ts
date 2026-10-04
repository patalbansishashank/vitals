import { sha256Hex, sha1, toHex, uuidV5 } from '@/biometrics/core/hash';
it('vectors', () => {
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(toHex(sha1('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
});
