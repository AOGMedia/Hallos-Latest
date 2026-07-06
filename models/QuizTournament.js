const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * QuizTournament Model
 * 
 * Stores tournament configuration and state
 * Supports multiple formats: Speed Run, Classic, Knockout, Battle Royale
 */

const QuizTournament = sequelize.define('QuizTournament', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  format: {
    type: DataTypes.ENUM('speed_run', 'classic', 'knockout', 'battle_royale'),
    allowNull: false
  },
  entryFee: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'entry_fee',
    comment: 'Entry fee in Chuta'
  },
  prizeDistribution: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: { first: 60, second: 30, third: 10 },
    field: 'prize_distribution',
    comment: 'Prize distribution percentages'
  },
  categoryId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'category_id',
    references: {
      model: 'quiz_categories',
      key: 'id'
    }
  },
  maxParticipants: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'max_participants'
  },
  minParticipants: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 2,
    field: 'min_participants'
  },
  registrationDeadline: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'registration_deadline'
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'start_time'
  },
  status: {
    type: DataTypes.ENUM('draft', 'open', 'in_progress', 'completed', 'cancelled'),
    allowNull: false,
    defaultValue: 'draft'
  },
  currentRound: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'current_round'
  },
  totalRounds: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'total_rounds'
  },
  prizePool: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    field: 'prize_pool',
    comment: 'Accumulated entry fees in Chuta'
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'created_by',
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  proposedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'proposed_by',
    references: {
      model: 'Users',
      key: 'id'
    }
  }
}, {
  tableName: 'quiz_tournaments',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['status', 'start_time']
    },
    {
      fields: ['registration_deadline']
    }
  ]
});

/**
 * Associations
 */
QuizTournament.associate = (models) => {
  QuizTournament.belongsTo(models.QuizCategory, {
    foreignKey: 'categoryId',
    as: 'category'
  });

  QuizTournament.belongsTo(models.User, {
    foreignKey: 'createdBy',
    as: 'creator'
  });

  QuizTournament.belongsTo(models.User, {
    foreignKey: 'proposedBy',
    as: 'proposer'
  });

  QuizTournament.hasMany(models.QuizTournamentParticipant, {
    foreignKey: 'tournamentId',
    as: 'participants'
  });

  QuizTournament.hasMany(models.QuizTournamentRound, {
    foreignKey: 'tournamentId',
    as: 'rounds'
  });

  QuizTournament.hasMany(models.QuizMatch, {
    foreignKey: 'tournamentId',
    as: 'matches'
  });
};

module.exports = QuizTournament;
