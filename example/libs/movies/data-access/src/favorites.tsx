import { Movie } from "@react-monorepo/shared-models";
import { useMovies } from "./movies.context";

export function useFavorites() {
  const { favoritesIds, addToFavorites, removeFromFavorites, movies } =
    useMovies();
  const favorites = movies.filter((movie) => !!favoritesIds[movie.id]);

  const isFavorite = (movie: Movie) => !!favoritesIds[movie.id];

  const toggleFavorite = (movie: Movie) => {
    const favoriteId = favoritesIds[movie.id];
    if (favoriteId) {
      removeFromFavorites(favoriteId, movie.id);
    } else {
      addToFavorites(movie);
    }
  };

  return {
    isFavorite,
    favoritesIds,
    favorites,
    addToFavorites,
    removeFromFavorites,
    toggleFavorite,
  };
}
