module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--primary)',
          light: 'var(--primary-light)',
        },
        secondary: 'var(--secondary)',
        background: 'var(--background)',
        card: 'var(--card)',
      },
      fontFamily: {
        signifier: ['Test Signifier', 'serif'],
      },
      animation: {
        scroll: 'scroll 25s linear infinite',
      },
      keyframes: {
        scroll: {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-50%)' },
        },
      },
    },
  },
};
