/**
 * Lee JWT_SECRET del entorno sin fallback hardcodeado. Si falta, se falla
 * rápido al arrancar en vez de firmar/verificar tokens con un secreto
 * público (visible en el repo) y por lo tanto falsificable.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET no está definido en el entorno. La aplicación no puede arrancar sin él.',
    );
  }
  return secret;
}
