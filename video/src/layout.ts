/** Where the card sits on the 960×720 canvas, and the sizes of its parts. */
export const CARD = { x: 40, y: 112, width: 360, imageHeight: 250, pad: 16, wellHeight: 207, buttonHeight: 58 }
export const CARD_HEIGHT = CARD.imageHeight + CARD.pad + CARD.wellHeight + 14 + CARD.buttonHeight + CARD.pad

/** Where the split Copy button's ▾ half sits on the canvas. */
export const CHEVRON = {
  x: CARD.x + CARD.width - CARD.pad - 28,
  y: CARD.y + CARD_HEIGHT - CARD.pad - CARD.buttonHeight / 2,
}

/** The "⋯" overlay button on the image (top right). */
export const MORE_BUTTON = { x: CARD.x + CARD.width - 34, y: CARD.y + 34 }
