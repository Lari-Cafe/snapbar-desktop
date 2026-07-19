// @ts-nocheck
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

import "./Counter.css";

function Number({ mv, number, height }) {
  const y = useTransform(mv, (latest) => {
    const placeValue = latest % 10;
    let offset = (10 + number - placeValue) % 10;
    if (offset > 5) offset -= 10;
    return offset * height;
  });

  return (
    <motion.span className="counter-number" style={{ y }}>
      {number}
    </motion.span>
  );
}

function Digit({ place, value, height, digitStyle }) {
  const valueRoundedToPlace = Math.floor(value / place);
  const animatedValue = useSpring(valueRoundedToPlace, {
    damping: 30,
    stiffness: 240,
    mass: 0.6,
  });
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) animatedValue.jump(valueRoundedToPlace);
    else animatedValue.set(valueRoundedToPlace);
  }, [animatedValue, reduceMotion, valueRoundedToPlace]);

  return (
    <span className="counter-digit" style={{ height, ...digitStyle }}>
      {Array.from({ length: 10 }, (_, number) => (
        <Number key={number} mv={animatedValue} number={number} height={height} />
      ))}
    </span>
  );
}

export default function Counter({
  value,
  fontSize = 100,
  padding = 0,
  gap = 0,
  textColor = "inherit",
  fontWeight = "inherit",
  containerStyle = undefined,
  counterStyle = undefined,
  digitStyle = undefined,
  gradientHeight = 0,
  minDigits = 1,
}) {
  const height = fontSize + padding;
  const places = String(value)
    .padStart(minDigits, "0")
    .split("")
    .map((_, index, digits) => 10 ** (digits.length - index - 1));

  return (
    <span className="counter-container" style={containerStyle}>
      <span
        className="counter-counter"
        style={{
          fontSize,
          gap,
          color: textColor,
          fontWeight,
          direction: "ltr",
          ...counterStyle,
        }}
      >
        {places.map((place) => (
          <Digit key={place} place={place} value={value} height={height} digitStyle={digitStyle} />
        ))}
      </span>
      {gradientHeight > 0 ? <span className="gradient-container" /> : null}
    </span>
  );
}
