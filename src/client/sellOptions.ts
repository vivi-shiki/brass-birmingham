import {validateSell} from '../common/gameEngine';
import type {GameState, SellStep} from '../common/types';
import {validationOk} from './validation';

export function canSubmitSell(
  game: GameState,
  playerId: string,
  cardId: string,
  sales: SellStep[],
): boolean {
  if (sales.length === 0) {
    return false;
  }
  return validationOk(() => validateSell(game, {
    type: 'sell',
    playerId,
    cardId,
    sales,
  }));
}
