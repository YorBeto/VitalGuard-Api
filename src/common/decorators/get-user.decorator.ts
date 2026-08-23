import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetVitalId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    // Cambiamos .vitalId por .sub, que es el identificador real en tu token JWT
    return request.user?.sub;
  },
);