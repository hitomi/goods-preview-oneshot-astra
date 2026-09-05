import type { BadgeShape } from "../domain/badges";

const outlines: Record<BadgeShape, string> = {
  circle: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  oval: "M12 5a10 7 0 1 0 0 14 10 7 0 0 0 0-14Z",
  rounded:
    "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z",
  rectangle:
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  heart: "M12 21C9 18 2 13 2 8a5 5 0 0 1 10-2 5 5 0 0 1 10 2c0 5-7 10-10 13Z",
  star: "m12 2 3.1 6.4 7.1 1-5.1 5 1.2 7.1L12 18.2l-6.3 3.3 1.2-7.1-5.1-5 7.1-1Z",
};

export function BadgeShapeIcon({
  shape,
  size = 21,
}: {
  shape: BadgeShape;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={outlines[shape]} />
    </svg>
  );
}
