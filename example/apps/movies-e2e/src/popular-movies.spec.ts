import { test, expect } from '@playwright/test';
import { mockPopularMovies } from './mocks/popular-movies.mock';

test('no favorites listed when not logged in', async ({ page }) => {
  page.goto('/favorites');

  const noFavoritesMessage = page.getByText('Not authenticated');
  await expect(noFavoritesMessage).toBeVisible();
});
