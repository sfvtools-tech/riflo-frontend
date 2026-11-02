export function Brand() {
  return (
    <span className="brand">
      <svg
        viewBox="0 0 32 32"
        width="30"
        height="30"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M7 25V14a7 7 0 0 1 14 0v2H11m10-2a5 5 0 0 1 5 5v6M11 14v11"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
      riflo<span className="brand-dot">.</span>
    </span>
  );
}
