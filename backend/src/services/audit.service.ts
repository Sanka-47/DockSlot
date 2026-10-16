import { prisma } from '../config/db.config';

export interface RecordAuditLogInput {
  bookingId: number;
  userId: number;
  action: 'CREATED' | 'UPDATED' | 'RESCHEDULED' | 'CANCELLED' | 'STATUS_CHANGED' | string;
  details?: Record<string, any>;
  summary?: string;
  tx?: any;
}

export class AuditLogService {
  /**
   * Helper to format actor name from email or details.
   */
  public formatActorName(email?: string, detailsName?: string): string {
    if (detailsName && detailsName.trim()) return detailsName.trim();
    if (!email) return 'System User';
    const namePart = email.split('@')[0];
    return namePart
      .split(/[._-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  /**
   * Generates a human-readable change summary based on action and details.
   */
  public generateSummary(action: string, details?: Record<string, any>): string {
    if (!details) return `Booking ${action.toLowerCase()}`;
    if (details.summary) return details.summary;

    switch (action) {
      case 'CREATED': {
        const truck = details.truckPlate ? `truck ${details.truckPlate}` : 'booking';
        const driver = details.driverName ? ` (Driver: ${details.driverName})` : '';
        return `Booking created for ${truck}${driver}`;
      }
      case 'RESCHEDULED': {
        const dockChange =
          details.oldDockId && details.newDockId && details.oldDockId !== details.newDockId
            ? ` from Dock #${details.oldDockId} to Dock #${details.newDockId}`
            : '';
        const timeChange = details.newSlotStartTime
          ? ` to ${new Date(details.newSlotStartTime).toLocaleString()}`
          : '';
        const reason = details.reason ? `. Reason: ${details.reason}` : '';
        return `Booking rescheduled${dockChange}${timeChange}${reason}`;
      }
      case 'UPDATED':
        return details.reason
          ? `Booking details updated: ${details.reason}`
          : 'Booking details updated';
      case 'CANCELLED':
        return details.reason
          ? `Booking cancelled. Reason: ${details.reason}`
          : 'Booking cancelled';
      case 'STATUS_CHANGED':
        return `Status updated from ${details.oldStatus || 'initial'} to ${details.newStatus}`;
      default:
        return `Action ${action} recorded`;
    }
  }

  /**
   * Records an audit log entry for a booking with actor metadata and change summary.
   */
  async recordLog(input: RecordAuditLogInput) {
    const client = input.tx || prisma;
    const { bookingId, userId, action, details = {}, summary } = input;

    let actorEmail = details.actor?.email;
    let actorRole = details.actor?.role;
    let actorName = details.actor?.name;

    if (!actorEmail || !actorRole) {
      try {
        const user = await client.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            role: true,
            organizationId: true,
          },
        });

        if (user) {
          actorEmail = user.email;
          actorRole = user.role;
          actorName = this.formatActorName(user.email);
        }
      } catch {
        // Fallback if transaction scope restricts query
      }
    }

    const computedSummary = summary || this.generateSummary(action, details);

    const fullDetails = {
      ...details,
      summary: computedSummary,
      actor: {
        userId,
        name: actorName || `User #${userId}`,
        role: actorRole || 'UNKNOWN',
        email: actorEmail || '',
      },
    };

    return client.auditLog.create({
      data: {
        bookingId,
        userId,
        action,
        details: fullDetails,
      },
    });
  }

  /**
   * Formats raw audit log entries for API responses.
   */
  public formatLogEntry(log: any) {
    const details = (log.details as Record<string, any>) || {};
    const actorName =
      details.actor?.name ||
      this.formatActorName(log.user?.email, details.actorName);
    const actorRole = details.actor?.role || log.user?.role || 'UNKNOWN';
    const summary = details.summary || this.generateSummary(log.action, details);

    // Map action to standard lifecycle action type (CREATED, MODIFIED, CANCELLED)
    let actionType = 'MODIFIED';
    if (log.action === 'CREATED') {
      actionType = 'CREATED';
    } else if (log.action === 'CANCELLED') {
      actionType = 'CANCELLED';
    } else {
      actionType = 'MODIFIED';
    }

    const actor = {
      userId: log.userId,
      name: actorName,
      role: actorRole,
      email: log.user?.email || '',
      organizationId: log.user?.organizationId,
      organizationName: log.user?.organization?.name,
    };

    return {
      id: log.id,
      bookingId: log.bookingId,
      action: log.action, // CREATED, RESCHEDULED, UPDATED, CANCELLED, STATUS_CHANGED
      actionType, // CREATED, MODIFIED, CANCELLED
      summary,
      details,
      createdAt: log.createdAt,
      userId: log.userId,
      actor,
      user: {
        id: log.user?.id || log.userId,
        email: log.user?.email || '',
        name: actorName,
        role: log.user?.role || actorRole,
        organizationId: log.user?.organizationId,
        organization: log.user?.organization,
      },
    };
  }
}

export const auditLogService = new AuditLogService();
