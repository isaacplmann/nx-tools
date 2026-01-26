import { createBrowserRouter } from 'react-router-dom';
import { ErrorPage } from '@react-monorepo/shared-feature-error-page';
import { Favorites } from '@react-monorepo/movies-feature-favorites-page';
import Homepage from '../homepage/homepage';
import { Root } from './root';
import { MovieDetails } from '@react-monorepo/movies-feature-detail-page';
import { GuardedRoute } from '@react-monorepo/shared-auth-feature-guarded-route';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Root />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: '',
        element: <Homepage />,
      },
      {
        path: 'movies/:movieId',
        element: <MovieDetails />,
      },
      {
        path: 'favorites',
        element: <GuardedRoute children={<Favorites />} />,
      },
    ],
  },
]);
