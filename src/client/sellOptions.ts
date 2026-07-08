import {validateSell} from '../common/gameEngine';
import type {GameState, SellStep} from '../common/types';

export function canSubmitSell(
  game: GameState,
  playerId: string,
  cardId: string,
  sales: SellStep[],
): boolean {
  if (sales.length === 0) {
    return false;
  }
  return validateSell(game, {
    type: 'sell',
    playerId,
    cardId,
    sales,
  }).ok;
}
