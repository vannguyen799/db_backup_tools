import { Inject, Controller, Get, Post, RouteGuards, NoGuard, Body } from 'truxie'
import { AuthGuard, Auth, type AuthPayload } from '$/guards/auth.guard'
import { AuthService } from '../services/auth.service'
import { sendSuccess } from '~/server/utils/response'

@Inject(AuthService)
@Controller('auth')
@RouteGuards(AuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/login')
  @NoGuard()
  async login(@Body() body: { email: string; password: string }) {
    const result = await this.authService.login(body)
    return sendSuccess(result, 'Login successful')
  }

  @Get('/me')
  async me(@Auth() auth: AuthPayload) {
    const user = await this.authService.getMe(auth.id)
    return sendSuccess(user)
  }

  @Post('/change-password')
  async changePassword(
    @Auth() auth: AuthPayload,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    await this.authService.changePassword(auth.id, body)
    return sendSuccess(null, 'Password updated')
  }
}
