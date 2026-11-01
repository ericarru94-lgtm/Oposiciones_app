"use client";

import { RoundedBox as DreiRoundedBox } from "@react-three/drei";
import type { ComponentProps } from "react";

/** Caja redondeada con pocas subdivisiones: el bisel se ve igual a esta distancia y pesa mucho menos. */
export function RoundedBox(props: ComponentProps<typeof DreiRoundedBox>) {
  return <DreiRoundedBox {...props} smoothness={1} />;
}
