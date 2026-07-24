import { Injectable, Logger } from '@nestjs/common';

/** Abstração de envio de email — trocar o provider EMAIL_SERVICE por uma
 *  implementação real (SMTP/SES/etc.) sem tocar no AuthService. */
export interface EmailService {
  sendPasswordReset(to: string, resetUrl: string): Promise<void>;
}

export const EMAIL_SERVICE = 'EMAIL_SERVICE';

/** Stub do MVP: apenas loga o link de reset (nunca loga a senha/hash). */
@Injectable()
export class LoggingEmailService implements EmailService {
  private readonly logger = new Logger(LoggingEmailService.name);

  constructor() {
    // Guard-rail: o stub que loga links de reset não pode passar despercebido
    // em produção. Não derruba o processo (a imagem de dev também roda com
    // NODE_ENV=production), mas grita no log que falta um EmailService real.
    if (process.env.NODE_ENV === 'production') {
      this.logger.error(
        'LoggingEmailService (stub) ativo com NODE_ENV=production — nenhum email real será enviado. ' +
          'Configure uma implementação real de EmailService (SMTP/SES/etc.) antes de ir ao ar.',
      );
    }
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    this.logger.log(`[email stub] Reset de senha para ${to}: ${resetUrl}`);
  }
}
