import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { createClerkClient } from '@clerk/backend';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);
    const secretKey = this.config.getOrThrow('CLERK_SECRET_KEY');

    let decoded;
    try {
      decoded = await verifyToken(token, { secretKey });
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }

    const clerkUserId = decoded.sub;

    let user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      const clerkUser = await this.clerk.users.getUser(clerkUserId);
      user = await this.prisma.user.upsert({
        where: { clerkUserId },
        update: {},
        create: {
          clerkUserId,
          email: clerkUser.emailAddresses[0]?.emailAddress || `user_${clerkUserId}@clerk.local`,
        },
      });
    }

    request.user = {
      sub: user.id,
      email: user.email,
      clerkUserId,
    };

    return true;
  }
}
