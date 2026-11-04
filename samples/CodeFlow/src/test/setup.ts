import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { resetAppStorageForTests } from '../storage';

// Every test starts with fresh, empty in-memory app storage.
beforeEach(() => {
  resetAppStorageForTests();
});
