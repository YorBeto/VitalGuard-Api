import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetVitalId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.vitalId;
  },
);

export const GetEmail = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.email;
  },
);